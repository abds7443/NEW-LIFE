package com.newlife.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * المجلدات في الهاتف:
 * - الحفظ في مجلد يختاره المستخدم (فك ضغط أرشيف كامل بمجلداته، أو حفظ عدة ملفات دفعة واحدة)
 * - اختيار مجلد كامل من الهاتف لضغطه في ZIP
 */
object Folders {
    private class Out(val root: Uri, val name: String) {
        val dirs = HashMap<String, Uri>()
    }

    private val outs = ConcurrentHashMap<String, Out>()
    private val BAD = Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]")

    fun safeName(s: String): String = s.replace(BAD, "_").trim().take(150)

    /** نافذة اختيار مجلد، ثم إنشاء مجلد فرعي داخله (إن طُلب). النتيجة: {id, name} */
    fun open(act: MainActivity, sub: String, done: (Boolean, String) -> Unit) {
        act.runOnUiThread {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            act.launchForResult(intent) { res ->
                val tree = res.data?.data
                if (res.resultCode != Activity.RESULT_OK || tree == null) {
                    done(false, "declined")
                    return@launchForResult
                }
                Thread {
                    try {
                        val cr = act.contentResolver
                        var root: Uri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
                        var name = act.displayName(root)
                        val s = safeName(sub)
                        if (s.isNotEmpty()) {
                            root = DocumentsContract.createDocument(cr, root, DocumentsContract.Document.MIME_TYPE_DIR, s)
                                ?: throw IllegalStateException("تعذر إنشاء المجلد")
                            name = name + "/" + act.displayName(root)
                        }
                        val id = UUID.randomUUID().toString()
                        outs[id] = Out(root, name)
                        done(true, JSONObject().put("id", id).put("name", name).toString())
                    } catch (e: Exception) {
                        done(false, e.message ?: "تعذر فتح المجلد")
                    }
                }.start()
            }
        }
    }

    /** كتابة ملف (من التخزين المؤقت) داخل المجلد المختار مع إنشاء المجلدات الفرعية. يعيد "" عند النجاح أو رسالة الخطأ. */
    fun write(act: MainActivity, id: String, relPath: String, token: String): String {
        val o = outs[id] ?: return "المجلد غير متاح — أعد المحاولة"
        return try {
            val parts = relPath.replace('\\', '/').split('/')
                .map { safeName(it) }
                .filter { it.isNotEmpty() && it != "." && it != ".." }
            if (parts.isEmpty()) return ""
            val cr = act.contentResolver
            var parent: Uri = o.root
            var key = ""
            synchronized(o) {
                for (d in parts.dropLast(1)) {
                    key = "$key/$d"
                    val existing = o.dirs[key]
                    if (existing != null) {
                        parent = existing
                    } else {
                        val made = DocumentsContract.createDocument(cr, parent, DocumentsContract.Document.MIME_TYPE_DIR, d)
                            ?: throw IllegalStateException("تعذر إنشاء المجلد $d")
                        o.dirs[key] = made
                        parent = made
                    }
                }
            }
            val name = parts.last()
            val ext = name.substringAfterLast('.', "").lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
            val doc = DocumentsContract.createDocument(cr, parent, mime, name) ?: return "تعذر إنشاء $name"
            val src = Blobs.file(token)
            cr.openOutputStream(doc, "w").use { out ->
                requireNotNull(out) { "تعذر الكتابة في المجلد" }
                src.inputStream().use { it.copyTo(out, 1 shl 16) }
            }
            src.delete()
            ""
        } catch (e: Exception) {
            e.message ?: "تعذر الحفظ"
        }
    }

    fun close(id: String) {
        outs.remove(id)
    }

    /** اختيار مجلد من الهاتف ونسخ ملفاته إلى التخزين المؤقت. النتيجة: {name, files:[{path,url,size,mtime}], dirs:[...]} */
    fun pick(act: MainActivity, done: (Boolean, String) -> Unit) {
        act.runOnUiThread {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            act.launchForResult(intent) { res ->
                val tree = res.data?.data
                if (res.resultCode != Activity.RESULT_OK || tree == null) {
                    done(false, "declined")
                    return@launchForResult
                }
                Thread {
                    try {
                        val cr = act.contentResolver
                        val rootId = DocumentsContract.getTreeDocumentId(tree)
                        val top = safeName(act.displayName(DocumentsContract.buildDocumentUriUsingTree(tree, rootId))).ifEmpty { "مجلد" }
                        val files = JSONArray()
                        val dirs = JSONArray()
                        var total = 0L
                        val cols = arrayOf(
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE,
                            DocumentsContract.Document.COLUMN_LAST_MODIFIED
                        )
                        val stack = ArrayDeque<Pair<String, String>>()
                        stack.addLast(rootId to top)
                        while (stack.isNotEmpty()) {
                            val (docId, path) = stack.removeLast()
                            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
                            cr.query(children, cols, null, null, null)?.use { c ->
                                while (c.moveToNext()) {
                                    val cid = c.getString(0) ?: continue
                                    val name = safeName(c.getString(1) ?: "file").ifEmpty { "file" }
                                    val mime = c.getString(2) ?: ""
                                    val p = "$path/$name"
                                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                                        dirs.put(p)
                                        stack.addLast(cid to p)
                                    } else {
                                        if (files.length() >= 5000) throw IllegalStateException("المجلد فيه ملفات كثيرة جداً (أكثر من 5000)")
                                        val size = if (c.isNull(3)) 0L else c.getLong(3)
                                        total += size
                                        if (total > 1_500_000_000L) throw IllegalStateException("حجم المجلد كبير جداً للهاتف (أكثر من 1.5 GB)")
                                        val tok = Blobs.fromUri(act, DocumentsContract.buildDocumentUriUsingTree(tree, cid), name)
                                        files.put(
                                            JSONObject().put("path", p).put("url", Blobs.url(tok)).put("size", size)
                                                .put("mtime", if (c.isNull(4)) 0L else c.getLong(4))
                                        )
                                    }
                                }
                            }
                        }
                        if (files.length() == 0 && dirs.length() == 0) throw IllegalStateException("المجلد فارغ")
                        done(true, JSONObject().put("name", top).put("files", files).put("dirs", dirs).toString())
                    } catch (e: Exception) {
                        done(false, e.message ?: "تعذر قراءة المجلد")
                    }
                }.start()
            }
        }
    }
}
