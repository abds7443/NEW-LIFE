package com.newlife.mobile

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * فتح وحماية ملفات Word وExcel وPowerPoint المحمية بكلمة مرور
 * (التشفير القياسي في Office 2007 والتشفير المتقدم Agile في Office 2010 وما بعده، وWPS).
 * الحاوية (CFB) تُقرأ وتُكتب في الواجهة؛ هنا التشفير فقط:
 *  - EncryptionInfo: وصف التشفير
 *  - EncryptedPackage: ملف docx/xlsx/pptx الأصلي مشفّراً
 */
object OfficeCrypto {

    private val BK_VERIFIER_INPUT = hex("fea7d2763b4b9e79")
    private val BK_VERIFIER_VALUE = hex("d7aa0f6d3061344e")
    private val BK_KEY = hex("146e0be7abacd0d6")
    private val BK_HMAC_KEY = hex("5fb2ad010cb9e1f6")
    private val BK_HMAC_VALUE = hex("a0677f02b22c8433")
    private const val SEGMENT = 4096

    class WrongPassword : IllegalArgumentException("كلمة المرور غير صحيحة")

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun le32(v: Int) = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array()
    private fun le64(v: Long) = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(v).array()
    private fun u32(b: ByteArray, o: Int) = ByteBuffer.wrap(b, o, 4).order(ByteOrder.LITTLE_ENDIAN).int
    private fun u16(b: ByteArray, o: Int) = ByteBuffer.wrap(b, o, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff

    private fun md(alg: String): MessageDigest = MessageDigest.getInstance(
        when (alg.uppercase()) { "SHA1", "SHA-1" -> "SHA-1"; "SHA256", "SHA-256" -> "SHA-256"; "SHA384", "SHA-384" -> "SHA-384"; else -> "SHA-512" })

    private fun hash(alg: String, vararg parts: ByteArray): ByteArray {
        val d = md(alg); parts.forEach { d.update(it) }; return d.digest()
    }

    /** يقصّ أو يكمّل بالقيمة 0x36 حتى الطول المطلوب (كما في المواصفة). */
    private fun fit(b: ByteArray, n: Int, pad: Byte = 0x36): ByteArray =
        if (b.size >= n) b.copyOf(n) else b + ByteArray(n - b.size) { pad }

    private fun padBlock(b: ByteArray, block: Int): ByteArray {
        val r = b.size % block
        return if (r == 0) b else b + ByteArray(block - r)
    }

    private fun aesCbc(mode: Int, key: ByteArray, iv: ByteArray, data: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/CBC/NoPadding")
        c.init(mode, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        return c.doFinal(data)
    }

    /** H0 = H(salt + كلمة المرور) ثم تكرار spinCount مرة. */
    private fun spin(alg: String, salt: ByteArray, password: String, count: Int): ByteArray {
        val d = md(alg)
        d.update(salt); d.update(password.toByteArray(Charsets.UTF_16LE))
        var h = d.digest()
        val idx = ByteArray(4)
        for (i in 0 until count) {
            idx[0] = i.toByte(); idx[1] = (i shr 8).toByte(); idx[2] = (i shr 16).toByte(); idx[3] = (i shr 24).toByte()
            d.update(idx); d.update(h); h = d.digest()
        }
        return h
    }

    // ───────────────────────── فك التشفير ─────────────────────────

    fun decrypt(info: ByteArray, pkg: ByteArray, password: String): ByteArray {
        require(info.size >= 8) { "ملف غير صالح" }
        val major = u16(info, 0); val minor = u16(info, 2)
        return when {
            major == 4 && minor == 4 -> decryptAgile(info, pkg, password)
            minor == 2 && major in 2..4 -> decryptStandard(info, pkg, password)
            else -> throw IllegalArgumentException("نوع تشفير غير مدعوم ($major.$minor)")
        }
    }

    private fun attr(xml: String, tag: String, name: String): String? {
        val el = Regex("<(?:\\w+:)?$tag\\b[^>]*>", RegexOption.DOT_MATCHES_ALL).find(xml)?.value ?: return null
        return Regex("\\b$name=\"([^\"]*)\"").find(el)?.groupValues?.get(1)
    }

    private fun b64(s: String?): ByteArray = Base64.getDecoder().decode(requireNotNull(s) { "ملف غير صالح" })

    private fun decryptAgile(info: ByteArray, pkg: ByteArray, password: String): ByteArray {
        val xml = String(info, 8, info.size - 8, Charsets.UTF_8)
        require(xml.contains("keyEncryptor/password")) { "الملف محمي بشهادة رقمية وليس بكلمة مرور" }
        // معلومات مفتاح كلمة المرور
        val pAlg = attr(xml, "encryptedKey", "hashAlgorithm") ?: "SHA512"
        val pBits = attr(xml, "encryptedKey", "keyBits")?.toInt() ?: 256
        val pBlock = attr(xml, "encryptedKey", "blockSize")?.toInt() ?: 16
        val pSpin = attr(xml, "encryptedKey", "spinCount")?.toInt() ?: 100000
        val pSalt = b64(attr(xml, "encryptedKey", "saltValue"))
        val pHashSize = attr(xml, "encryptedKey", "hashSize")?.toInt() ?: md(pAlg).digestLength
        require((attr(xml, "encryptedKey", "cipherAlgorithm") ?: "AES") == "AES") { "خوارزمية تشفير غير مدعومة" }
        val h = spin(pAlg, pSalt, password, pSpin)
        fun keyFor(block: ByteArray) = fit(hash(pAlg, h, block), pBits / 8)
        val iv = fit(pSalt, pBlock)
        // التحقق من كلمة المرور
        val vIn = aesCbc(Cipher.DECRYPT_MODE, keyFor(BK_VERIFIER_INPUT), iv, b64(attr(xml, "encryptedKey", "encryptedVerifierHashInput")))
        val vVal = aesCbc(Cipher.DECRYPT_MODE, keyFor(BK_VERIFIER_VALUE), iv, b64(attr(xml, "encryptedKey", "encryptedVerifierHashValue")))
        val expect = hash(pAlg, vIn.copyOf(pSalt.size))
        if (!expect.copyOf(pHashSize).contentEquals(vVal.copyOf(pHashSize))) throw WrongPassword()
        val secret = aesCbc(Cipher.DECRYPT_MODE, keyFor(BK_KEY), iv, b64(attr(xml, "encryptedKey", "encryptedKeyValue")))
        // معلومات تشفير البيانات
        val kAlg = attr(xml, "keyData", "hashAlgorithm") ?: "SHA512"
        val kBits = attr(xml, "keyData", "keyBits")?.toInt() ?: 256
        val kBlock = attr(xml, "keyData", "blockSize")?.toInt() ?: 16
        val kSalt = b64(attr(xml, "keyData", "saltValue"))
        val key = secret.copyOf(kBits / 8)
        val size = ByteBuffer.wrap(pkg, 0, 8).order(ByteOrder.LITTLE_ENDIAN).long
        require(size in 0..(pkg.size.toLong())) { "الملف تالف" }
        val out = ByteArrayOutputStream(size.toInt())
        var off = 8; var seg = 0
        while (off < pkg.size && out.size() < size) {
            val len = minOf(SEGMENT, pkg.size - off)
            val chunk = pkg.copyOfRange(off, off + len - len % kBlock)
            if (chunk.isEmpty()) break
            val siv = fit(hash(kAlg, kSalt, le32(seg)), kBlock)
            out.write(aesCbc(Cipher.DECRYPT_MODE, key, siv, chunk))
            off += len; seg++
        }
        return out.toByteArray().copyOf(size.toInt())
    }

    private fun decryptStandard(info: ByteArray, pkg: ByteArray, password: String): ByteArray {
        val headerSize = u32(info, 8)
        val h = 12
        val algId = u32(info, h + 8)
        val keyBits = u32(info, h + 16).let { if (it == 0) 128 else it }
        require(algId == 0x660E || algId == 0x660F || algId == 0x6610 || algId == 0) { "تشفير قديم غير مدعوم (RC4)" }
        var p = h + headerSize
        val saltSize = u32(info, p); p += 4
        val salt = info.copyOfRange(p, p + saltSize); p += saltSize
        val encVerifier = info.copyOfRange(p, p + 16); p += 16
        val verifierHashSize = u32(info, p); p += 4
        val encVerifierHash = info.copyOfRange(p, minOf(info.size, p + 32))
        // اشتقاق المفتاح (SHA-1 مع 50000 تكرار)
        val hf = hash("SHA1", spin("SHA1", salt, password, 50000), le32(0))
        val x1 = hash("SHA1", ByteArray(64) { 0x36 }.also { for (i in hf.indices) it[i] = (it[i].toInt() xor hf[i].toInt()).toByte() })
        val x2 = hash("SHA1", ByteArray(64) { 0x5c }.also { for (i in hf.indices) it[i] = (it[i].toInt() xor hf[i].toInt()).toByte() })
        val key = (x1 + x2).copyOf(keyBits / 8)
        val ecb = Cipher.getInstance("AES/ECB/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES")) }
        val verifier = ecb.doFinal(encVerifier)
        val vh = ecb.doFinal(padBlock(encVerifierHash, 16))
        if (!hash("SHA1", verifier).contentEquals(vh.copyOf(verifierHashSize))) throw WrongPassword()
        val size = ByteBuffer.wrap(pkg, 0, 8).order(ByteOrder.LITTLE_ENDIAN).long
        val body = pkg.copyOfRange(8, 8 + (pkg.size - 8) / 16 * 16)
        return ecb.doFinal(body).copyOf(size.toInt())
    }

    // ───────────────────────── التشفير (Agile: AES-256 + SHA-512) ─────────────────────────

    /** يعيد (EncryptionInfo، EncryptedPackage). */
    fun encrypt(plain: ByteArray, password: String): Pair<ByteArray, ByteArray> {
        require(password.isNotEmpty()) { "أدخل كلمة مرور" }
        val rnd = SecureRandom()
        val alg = "SHA512"; val block = 16; val keyBytes = 32; val spinCount = 100000
        val keySalt = ByteArray(16).also { rnd.nextBytes(it) }
        val pSalt = ByteArray(16).also { rnd.nextBytes(it) }
        val secret = ByteArray(keyBytes).also { rnd.nextBytes(it) }
        val verifierInput = ByteArray(16).also { rnd.nextBytes(it) }
        val hmacKey = ByteArray(64).also { rnd.nextBytes(it) }

        // الحزمة المشفرة
        val pkg = ByteArrayOutputStream(plain.size + 4200)
        pkg.write(le64(plain.size.toLong()))
        var off = 0; var seg = 0
        while (off < plain.size) {
            val len = minOf(SEGMENT, plain.size - off)
            val siv = fit(hash(alg, keySalt, le32(seg)), block)
            pkg.write(aesCbc(Cipher.ENCRYPT_MODE, secret, siv, padBlock(plain.copyOfRange(off, off + len), block)))
            off += len; seg++
        }
        val pkgBytes = pkg.toByteArray()

        // سلامة البيانات (HMAC)
        val mac = Mac.getInstance("HmacSHA512").apply { init(SecretKeySpec(hmacKey, "HmacSHA512")) }.doFinal(pkgBytes)
        val encHmacKey = aesCbc(Cipher.ENCRYPT_MODE, secret, fit(hash(alg, keySalt, BK_HMAC_KEY), block), padBlock(hmacKey, block))
        val encHmacValue = aesCbc(Cipher.ENCRYPT_MODE, secret, fit(hash(alg, keySalt, BK_HMAC_VALUE), block), padBlock(mac, block))

        // مفتاح كلمة المرور
        val h = spin(alg, pSalt, password, spinCount)
        fun keyFor(b: ByteArray) = fit(hash(alg, h, b), keyBytes)
        val iv = fit(pSalt, block)
        val encVerInput = aesCbc(Cipher.ENCRYPT_MODE, keyFor(BK_VERIFIER_INPUT), iv, padBlock(verifierInput, block))
        val encVerValue = aesCbc(Cipher.ENCRYPT_MODE, keyFor(BK_VERIFIER_VALUE), iv, padBlock(hash(alg, verifierInput), block))
        val encKey = aesCbc(Cipher.ENCRYPT_MODE, keyFor(BK_KEY), iv, padBlock(secret, block))

        val e = { b: ByteArray -> Base64.getEncoder().encodeToString(b) }
        val xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n" +
            "<encryption xmlns=\"http://schemas.microsoft.com/office/2006/encryption\" xmlns:p=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\" xmlns:c=\"http://schemas.microsoft.com/office/2006/keyEncryptor/certificate\">" +
            "<keyData saltSize=\"16\" blockSize=\"16\" keyBits=\"256\" hashSize=\"64\" cipherAlgorithm=\"AES\" cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" saltValue=\"${e(keySalt)}\"/>" +
            "<dataIntegrity encryptedHmacKey=\"${e(encHmacKey)}\" encryptedHmacValue=\"${e(encHmacValue)}\"/>" +
            "<keyEncryptors><keyEncryptor uri=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\">" +
            "<p:encryptedKey spinCount=\"$spinCount\" saltSize=\"16\" blockSize=\"16\" keyBits=\"256\" hashSize=\"64\" cipherAlgorithm=\"AES\" cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" " +
            "saltValue=\"${e(pSalt)}\" encryptedVerifierHashInput=\"${e(encVerInput)}\" encryptedVerifierHashValue=\"${e(encVerValue)}\" encryptedKeyValue=\"${e(encKey)}\"/>" +
            "</keyEncryptor></keyEncryptors></encryption>"
        val info = byteArrayOf(4, 0, 4, 0, 0x40, 0, 0, 0) + xml.toByteArray(Charsets.UTF_8)
        return info to pkgBytes
    }
}
