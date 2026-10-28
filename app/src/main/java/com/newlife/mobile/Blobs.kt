package com.newlife.mobile

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * مخزن ملفات مؤقت مشترك بين الواجهة والتطبيق.
 * الواجهة تقرأ الملف عبر https://appassets.androidplatform.net/blobs/<token>
 * وتكتب إليه على دفعات (Base64) عبر الجسر.
 */
object Blobs {
    lateinit var dir: File
        private set
    private val SAFE = Regex("^[A-Za-z0-9._-]{1,120}$")

    fun init(ctx: Context) {
        dir = File(ctx.cacheDir, "blobs").apply { mkdirs() }
        // حذف الملفات المؤقتة الأقدم من يومين
        val old = System.currentTimeMillis() - 2L * 24 * 3600 * 1000
        dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
    }

    fun ext(name: String?): String {
        val e = name?.substringAfterLast('.', "")?.lowercase() ?: ""
        return if (e.matches(Regex("^[a-z0-9]{1,8}$"))) e else "bin"
    }

    fun newToken(ext: String): String = UUID.randomUUID().toString().replace("-", "") + "." + ext(".$ext")

    fun file(token: String): File {
        require(SAFE.matches(token) && !token.contains("..")) { "bad token" }
        return File(dir, token)
    }

    fun url(token: String) = "https://appassets.androidplatform.net/blobs/$token"

    fun create(ext: String): String {
        val t = newToken(ext)
        file(t).writeBytes(ByteArray(0))
        return t
    }

    fun append(token: String, b64: String) {
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        FileOutputStream(file(token), true).use { it.write(bytes) }
    }

    fun fromUri(ctx: Context, uri: Uri, name: String?): String {
        val t = newToken(ext(name))
        ctx.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "تعذر قراءة الملف" }
            file(t).outputStream().use { out -> input.copyTo(out, 1 shl 16) }
        }
        return t
    }

    fun fromBytes(bytes: ByteArray, ext: String): String {
        val t = newToken(ext)
        file(t).writeBytes(bytes)
        return t
    }

    fun fromFile(src: File, ext: String): String {
        val t = newToken(ext)
        src.copyTo(file(t), overwrite = true)
        return t
    }
}
