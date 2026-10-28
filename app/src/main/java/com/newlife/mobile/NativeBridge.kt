package com.newlife.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import androidx.activity.result.IntentSenderRequest
import androidx.core.content.FileProvider
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.googlecode.tesseract.android.TessBaseAPI
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * الجسر بين واجهة NEW LIFE (JavaScript) وقدرات الهاتف.
 * العمليات الطويلة تعيد نتيجتها عبر window.NLNative.done(cb, ok, payload).
 */
class NativeBridge(private val act: MainActivity) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var pdfBoxReady = false
    private val tessLock = Any()

    private fun run(cb: String, block: suspend () -> Any?) {
        scope.launch(Dispatchers.IO) {
            try {
                act.reply(cb, true, block())
            } catch (e: Throwable) {
                act.reply(cb, false, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    fun shutdown() {
        tts?.shutdown()
        scope.cancel()
    }

    // ───────── أساسيات ─────────
    @JavascriptInterface fun isNative(): Boolean = true
    @JavascriptInterface fun version(): String = "1.0"
    @JavascriptInterface fun ready() = act.onPageReady()
    @JavascriptInterface fun toast(msg: String) = act.toast(msg)

    /** إنشاء ملف مؤقت لتكتب فيه الواجهة على دفعات. */
    @JavascriptInterface fun begin(ext: String): String = Blobs.create(ext)
    @JavascriptInterface fun chunk(token: String, b64: String) = Blobs.append(token, b64)
    @JavascriptInterface fun blobUrl(token: String): String = Blobs.url(token)

    // ───────── الحفظ والمشاركة ─────────
    @JavascriptInterface
    fun saveAs(token: String, filename: String, mime: String, cb: String) {
        val src = try { Blobs.file(token) } catch (e: Exception) { act.reply(cb, false, "bad token"); return }
        act.runOnUiThread {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_TITLE, filename)
            }
            act.launchForResult(intent) { res ->
                val uri = res.data?.data
                if (res.resultCode != Activity.RESULT_OK || uri == null) {
                    act.reply(cb, false, "declined")
                    return@launchForResult
                }
                scope.launch(Dispatchers.IO) {
                    try {
                        act.contentResolver.openOutputStream(uri, "wt").use { out ->
                            requireNotNull(out)
                            src.inputStream().use { it.copyTo(out, 1 shl 16) }
                        }
                        act.reply(cb, true, act.displayName(uri))
                    } catch (e: Exception) {
                        act.reply(cb, false, e.message ?: "write failed")
                    }
                }
            }
        }
    }

    private fun shareUri(token: String, filename: String): android.net.Uri {
        val dir = File(act.cacheDir, "share").apply { mkdirs() }
        val safe = filename.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "file" }
        val f = File(dir, safe)
        Blobs.file(token).copyTo(f, overwrite = true)
        return FileProvider.getUriForFile(act, "${act.packageName}.files", f)
    }

    @JavascriptInterface
    fun share(token: String, filename: String, mime: String) {
        act.runOnUiThread {
            try {
                val uri = shareUri(token, filename)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mime.ifBlank { "application/octet-stream" }
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                act.startActivity(Intent.createChooser(send, "مشاركة"))
            } catch (e: Exception) {
                act.toast("تعذرت المشاركة: ${e.message}")
            }
        }
    }

    @JavascriptInterface
    fun openWith(token: String, filename: String, mime: String) {
        act.runOnUiThread {
            try {
                val uri = shareUri(token, filename)
                val view = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime.ifBlank { "*/*" })
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                act.startActivity(Intent.createChooser(view, "فتح باستخدام"))
            } catch (e: ActivityNotFoundException) {
                act.toast("لا يوجد تطبيق آخر يفتح هذا الملف")
            } catch (e: Exception) {
                act.toast("تعذر الفتح: ${e.message}")
            }
        }
    }

    // ───────── قراءة النصوص من الصور (دون إنترنت) ─────────
    private fun loadBitmap(token: String, maxSide: Int = 2600): Bitmap {
        val f = Blobs.file(token)
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var sample = 1
        while (maxOf(o.outWidth, o.outHeight) / sample > maxSide) sample *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("الصورة غير صالحة")
    }

    private fun tesseract(bmp: Bitmap): String = synchronized(tessLock) {
        val root = File(act.filesDir, "tesseract")
        val td = File(root, "tessdata").apply { mkdirs() }
        for (lang in listOf("ara", "eng")) {
            val f = File(td, "$lang.traineddata")
            if (!f.exists() || f.length() == 0L) {
                act.assets.open("tessdata/$lang.traineddata").use { i -> f.outputStream().use { o -> i.copyTo(o) } }
            }
        }
        val api = TessBaseAPI()
        try {
            if (!api.init(root.absolutePath, "ara+eng")) throw IllegalStateException("تعذر تشغيل محرك القراءة")
            api.setImage(bmp)
            api.getUTF8Text() ?: ""
        } finally {
            api.recycle()
        }
    }

    private suspend fun ocrBitmap(bmp: Bitmap): String {
        val latin = try {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                .process(InputImage.fromBitmap(bmp, 0)).await().text
        } catch (e: Exception) { "" }
        val tess = try { tesseract(bmp) } catch (e: Exception) { "" }
        val arabic = tess.count { it in '؀'..'ۿ' }
        val letters = tess.count { it.isLetter() }.coerceAtLeast(1)
        // النص العربي من Tesseract، والنص اللاتيني من ML Kit (أدق)
        return if (arabic > letters * 0.15 || latin.isBlank()) tess.trim() else latin.trim()
    }

    @JavascriptInterface
    fun ocr(tokensJson: String, cb: String) = run(cb) {
        val arr = JSONArray(tokensJson)
        val parts = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val bmp = loadBitmap(arr.getString(i))
            parts.add(ocrBitmap(bmp).ifBlank { "(لا يوجد نص)" })
            bmp.recycle()
        }
        parts.joinToString("\n---\n")
    }

    // ───────── الترجمة على الهاتف ─────────
    @JavascriptInterface
    fun translate(text: String, target: String, cb: String) = run(cb) {
        val isAr = text.any { it in '؀'..'ۿ' }
        val id = try { LanguageIdentification.getClient().identifyLanguage(text.take(600)).await() } catch (e: Exception) { "und" }
        val src = TranslateLanguage.fromLanguageTag(if (id == "und") (if (isAr) "ar" else "en") else id)
            ?: if (isAr) TranslateLanguage.ARABIC else TranslateLanguage.ENGLISH
        var tgt = TranslateLanguage.fromLanguageTag(target)
            ?: throw IllegalArgumentException("هذه اللغة غير مدعومة في الترجمة على الهاتف")
        if (tgt == src) tgt = if (tgt == TranslateLanguage.ENGLISH) TranslateLanguage.ARABIC else TranslateLanguage.ENGLISH
        val tr = Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(tgt).build())
        try {
            tr.downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
            val out = StringBuilder()
            for (line in text.split("\n")) {
                if (line.isNotBlank()) out.append(tr.translate(line).await())
                out.append('\n')
            }
            out.toString().trimEnd()
        } finally {
            tr.close()
        }
    }

    // ───────── القراءة بصوت ─────────
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeak: String? = null

    @JavascriptInterface
    fun speak(text: String) {
        act.runOnUiThread {
            if (tts == null) {
                pendingSpeak = text
                tts = TextToSpeech(act) { status ->
                    ttsReady = status == TextToSpeech.SUCCESS
                    if (ttsReady) {
                        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) {}
                            override fun onDone(utteranceId: String?) {
                                if (utteranceId == "last") act.runOnUiThread {
                                    act.web.evaluateJavascript("window.NL_speakDone && window.NL_speakDone()", null)
                                }
                            }
                            @Deprecated("Deprecated in Java")
                            override fun onError(utteranceId: String?) {}
                        })
                        pendingSpeak?.let { doSpeak(it) }
                    } else {
                        act.toast("محرك تحويل النص إلى كلام غير متاح في الهاتف")
                    }
                    pendingSpeak = null
                }
            } else if (ttsReady) {
                doSpeak(text)
            }
        }
    }

    private fun doSpeak(text: String) {
        val t = tts ?: return
        val ar = text.any { it in '؀'..'ۿ' }
        val r = t.setLanguage(if (ar) Locale("ar") else Locale.US)
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            act.toast(if (ar) "لا يوجد صوت عربي في الهاتف. ثبّته من الإعدادات ← تحويل النص إلى كلام" else "اللغة غير مدعومة في محرك الصوت")
            try {
                act.startActivity(Intent("com.android.settings.TTS_SETTINGS"))
            } catch (_: Exception) {
            }
            return
        }
        val chunks = text.chunked(3500)
        chunks.forEachIndexed { i, c ->
            t.speak(c, if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null,
                if (i == chunks.size - 1) "last" else "p$i")
        }
    }

    @JavascriptInterface
    fun stopSpeak() {
        act.runOnUiThread { tts?.stop() }
    }

    // ───────── الماسح الذكي (Google ML Kit) ─────────
    @JavascriptInterface
    fun docScan(cb: String) {
        act.runOnUiThread {
            val opts = GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(true)
                .setPageLimit(60)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build()
            GmsDocumentScanning.getClient(opts).getStartScanIntent(act)
                .addOnSuccessListener { sender ->
                    act.launchSender(IntentSenderRequest.Builder(sender).build()) { res ->
                        if (res.resultCode != Activity.RESULT_OK) {
                            act.reply(cb, false, "cancel")
                            return@launchSender
                        }
                        val result = GmsDocumentScanningResult.fromActivityResultIntent(res.data)
                        run(cb) {
                            val images = JSONArray()
                            result?.pages?.forEach { p -> images.put(Blobs.url(Blobs.fromUri(act, p.imageUri, "page.jpg"))) }
                            val pdf = result?.pdf?.let { Blobs.url(Blobs.fromUri(act, it.uri, "scan.pdf")) }
                            JSONObject().put("images", images).put("pdf", pdf ?: JSONObject.NULL)
                        }
                    }
                }
                .addOnFailureListener { e -> act.reply(cb, false, e.message ?: "unavailable") }
        }
    }

    // ───────── الباركود ─────────
    @JavascriptInterface
    fun barcodeLive(cb: String) {
        act.runOnUiThread {
            act.launchForResult(Intent(act, BarcodeActivity::class.java)) { res ->
                val r = res.data?.getStringExtra(BarcodeActivity.EXTRA_RESULT)
                if (res.resultCode == Activity.RESULT_OK && r != null) act.reply(cb, true, r) else act.reply(cb, false, "cancel")
            }
        }
    }

    @JavascriptInterface
    fun barcodeImage(token: String, cb: String) = run(cb) {
        val bmp = loadBitmap(token, 2000)
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build())
        val list = scanner.process(InputImage.fromBitmap(bmp, 0)).await()
        BarcodeActivity.toJson(list).toString()
    }

    // ───────── حماية ملفات PDF بكلمة مرور ─────────
    private fun pdfBox() {
        if (!pdfBoxReady) {
            PDFBoxResourceLoader.init(act.applicationContext)
            pdfBoxReady = true
        }
    }

    @JavascriptInterface
    fun pdfUnlock(token: String, password: String, cb: String) = run(cb) {
        pdfBox()
        val doc = try {
            PDDocument.load(Blobs.file(token), password)
        } catch (e: InvalidPasswordException) {
            throw IllegalArgumentException("كلمة المرور غير صحيحة")
        }
        doc.use { d ->
            d.isAllSecurityToBeRemoved = true
            val out = Blobs.create("pdf")
            d.save(Blobs.file(out))
            Blobs.url(out)
        }
    }

    @JavascriptInterface
    fun pdfLock(token: String, userPassword: String, ownerPassword: String, allowPrint: Boolean, allowCopy: Boolean, cb: String) = run(cb) {
        pdfBox()
        PDDocument.load(Blobs.file(token)).use { d ->
            val ap = AccessPermission()
            ap.setCanPrint(allowPrint)
            ap.setCanExtractContent(allowCopy)
            ap.setCanModify(false)
            val policy = StandardProtectionPolicy(ownerPassword.ifBlank { userPassword + "#owner" }, userPassword, ap)
            policy.encryptionKeyLength = 256
            d.protect(policy)
            val out = Blobs.create("pdf")
            d.save(Blobs.file(out))
            Blobs.url(out)
        }
    }

    // ───────── تشفير أي ملف (AES-256) ─────────
    @JavascriptInterface
    fun encryptFile(token: String, name: String, password: String, cb: String) = run(cb) {
        val out = Blobs.create("nlenc")
        FileCrypto.encrypt(Blobs.file(token), name, password, Blobs.file(out))
        Blobs.url(out)
    }

    @JavascriptInterface
    fun decryptFile(token: String, password: String, cb: String) = run(cb) {
        val (name, data) = FileCrypto.decrypt(Blobs.file(token), password)
        val out = Blobs.fromBytes(data, Blobs.ext(name))
        JSONObject().put("url", Blobs.url(out)).put("name", name).toString()
    }
}
