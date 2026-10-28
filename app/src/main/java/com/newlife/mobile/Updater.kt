package com.newlife.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * التحديث التلقائي من صفحة الإصدارات في GitHub (مجاني، دون حساب):
 * يقارن رقم الإصدار المثبت بآخر إصدار منشور، وينزّل ملف APK ويفتح نافذة التثبيت.
 */
object Updater {

    fun repo(act: MainActivity): String = act.getString(R.string.update_repo)

    fun currentCode(act: MainActivity): Long =
        PackageInfoCompat.getLongVersionCode(act.packageManager.getPackageInfo(act.packageName, 0))

    fun currentName(act: MainActivity): String =
        act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "1.0"

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.setRequestProperty("User-Agent", "NewLife-Android")
        c.connectTimeout = 15000
        c.readTimeout = 20000
        try {
            if (c.responseCode == 404) throw IllegalStateException("لا توجد إصدارات منشورة بعد")
            if (c.responseCode !in 200..299) throw IllegalStateException("تعذر الاتصال بصفحة التحديثات (${c.responseCode})")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    /** يعيد JSON: {available, current, currentName, latest, tag, url, size, notes, page} */
    fun check(act: MainActivity): JSONObject {
        val repo = repo(act)
        val rel = JSONObject(get("https://api.github.com/repos/$repo/releases/latest"))
        val tag = rel.optString("tag_name")
        val run = Regex("(\\d+)$").find(tag)?.value?.toLongOrNull() ?: 0L
        val latestCode = 100 + run   // نفس معادلة رقم الإصدار في build.gradle.kts
        var apkUrl = ""
        var size = 0L
        val assets = rel.optJSONArray("assets")
        if (assets != null) for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            if (a.optString("name").endsWith(".apk")) {
                apkUrl = a.optString("browser_download_url")
                size = a.optLong("size")
                break
            }
        }
        val cur = currentCode(act)
        return JSONObject()
            .put("available", apkUrl.isNotEmpty() && latestCode > cur)
            .put("current", cur)
            .put("currentName", currentName(act))
            .put("latest", latestCode)
            .put("tag", tag)
            .put("url", apkUrl)
            .put("size", size)
            .put("notes", rel.optString("body"))
            .put("page", "https://github.com/$repo/releases/latest")
    }

    /** تنزيل ملف التحديث مع نسبة التقدم. */
    fun download(act: MainActivity, url: String, progress: (Int) -> Unit): File {
        val dir = File(act.cacheDir, "update").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "NewLife-update.apk")
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "NewLife-Android")
        c.connectTimeout = 15000
        c.readTimeout = 30000
        c.instanceFollowRedirects = true
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("تعذر تنزيل التحديث (${c.responseCode})")
            val total = c.contentLengthLong
            var done = 0L
            var last = -1
            c.inputStream.use { input ->
                out.outputStream().use { o ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val p = (done * 100 / total).toInt()
                            if (p != last) { last = p; progress(p) }
                        }
                    }
                }
            }
            if (total > 0 && out.length() != total) throw IllegalStateException("انقطع التنزيل، أعد المحاولة")
        } finally {
            c.disconnect()
        }
        return out
    }

    /** يحتاج أندرويد إذناً لمرة واحدة حتى يثبّت التطبيق تحديثاته. */
    fun canInstall(act: MainActivity): Boolean =
        Build.VERSION.SDK_INT < 26 || act.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(act: MainActivity) {
        act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
    }

    fun install(act: MainActivity, apk: File) {
        val uri = FileProvider.getUriForFile(act, "${act.packageName}.files", apk)
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        act.startActivity(i)
    }

    /** نسخة من التطبيق المثبت نفسه لإرسالها إلى هاتف أو تابلت آخر. */
    fun shareApp(act: MainActivity) {
        val dir = File(act.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, "NewLife-${currentName(act)}.apk")
        File(act.applicationInfo.sourceDir).copyTo(f, overwrite = true)
        val uri = FileProvider.getUriForFile(act, "${act.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/vnd.android.package-archive"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        act.startActivity(Intent.createChooser(send, "إرسال التطبيق إلى جهاز آخر"))
    }
}
