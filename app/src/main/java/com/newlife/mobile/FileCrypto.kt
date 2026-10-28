package com.newlife.mobile

import java.io.File
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * تشفير أي ملف بكلمة مرور: AES-256-GCM مع اشتقاق المفتاح PBKDF2-SHA256.
 * صيغة الملف (.nlenc): "NLENC1" + ملح 16 بايت + IV 12 بايت + البيانات المشفرة
 * (وداخلها اسم الملف الأصلي ثم محتواه).
 */
object FileCrypto {
    private val MAGIC = "NLENC1".toByteArray(Charsets.US_ASCII)
    private const val ITERATIONS = 150_000

    private fun key(password: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return SecretKeySpec(bytes, "AES")
    }

    fun encrypt(input: File, name: String, password: String, out: File) {
        require(password.length >= 4) { "كلمة المرور قصيرة جداً (4 أحرف على الأقل)" }
        val rnd = SecureRandom()
        val salt = ByteArray(16).also { rnd.nextBytes(it) }
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val nameBytes = name.toByteArray(Charsets.UTF_8).take(1000).toByteArray()
        val data = input.readBytes()
        val plain = ByteBuffer.allocate(2 + nameBytes.size + data.size)
            .putShort(nameBytes.size.toShort()).put(nameBytes).put(data).array()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key(password, salt), GCMParameterSpec(128, iv))
        val enc = c.doFinal(plain)
        out.outputStream().use { o ->
            o.write(MAGIC); o.write(salt); o.write(iv); o.write(enc)
        }
    }

    /** يعيد (اسم الملف الأصلي، المحتوى). */
    fun decrypt(input: File, password: String): Pair<String, ByteArray> {
        val all = input.readBytes()
        require(all.size > MAGIC.size + 28 && all.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) {
            "هذا الملف ليس ملفاً مشفراً بواسطة NEW LIFE"
        }
        var p = MAGIC.size
        val salt = all.copyOfRange(p, p + 16); p += 16
        val iv = all.copyOfRange(p, p + 12); p += 12
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(password, salt), GCMParameterSpec(128, iv))
        val plain = try {
            c.doFinal(all, p, all.size - p)
        } catch (e: AEADBadTagException) {
            throw IllegalArgumentException("كلمة المرور غير صحيحة")
        }
        val buf = ByteBuffer.wrap(plain)
        val n = buf.short.toInt() and 0xFFFF
        val nameBytes = ByteArray(n).also { buf.get(it) }
        val data = ByteArray(buf.remaining()).also { buf.get(it) }
        return Pair(String(nameBytes, Charsets.UTF_8), data)
    }
}
