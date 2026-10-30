package com.firefly.luma;

import android.app.Activity;
import android.app.SearchManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.MediaStore;

import java.util.List;
import java.util.Locale;

/**
 * Things Luma can do on the phone when she's asked: each one just opens the right app at the right
 * place (an alarm screen, a search, a map, the dialer). She never sends, buys, deletes or calls by
 * herself; the person finishes anything that matters. Returns a short result for the page.
 */
final class Actions {
    private Actions() { }

    static String run(Activity a, String name, String arg) {
        switch (name) {
            case "open_app": return openApp(a, arg);
            case "open_url": {
                Uri u = Uri.parse(arg.startsWith("http") ? arg : "https://" + arg);
                if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return "failed";
                return start(a, new Intent(Intent.ACTION_VIEW, u));
            }
            case "search": {
                Intent i = new Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, arg);
                if (start(a, i).equals("ok")) return "ok";
                return start(a, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(arg))));
            }
            case "maps": return start(a, new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(arg))));
            case "call": return start(a, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + arg.replaceAll("[^0-9+*#]", ""))));   // opens the dialer only
            case "alarm": {
                String[] hm = arg.replaceAll("[^0-9:]", "").split(":");
                if (hm.length < 2) return "failed";
                Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
                        .putExtra(AlarmClock.EXTRA_HOUR, Integer.parseInt(hm[0]))
                        .putExtra(AlarmClock.EXTRA_MINUTES, Integer.parseInt(hm[1]))
                        .putExtra(AlarmClock.EXTRA_MESSAGE, "Luma 🌙");
                return start(a, i);
            }
            case "timer": {
                int minutes = Integer.parseInt(arg.replaceAll("[^0-9]", "").isEmpty() ? "0" : arg.replaceAll("[^0-9]", ""));
                if (minutes <= 0) return "failed";
                Intent i = new Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, minutes * 60)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, "Luma 🌙").putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                return start(a, i);
            }
            case "music": {
                Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).putExtra(SearchManager.QUERY, arg);
                if (start(a, i).equals("ok")) return "ok";
                return start(a, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(arg))));
            }
            default: return "unknown";
        }
    }

    /** Opens the installed app whose name best matches. */
    private static String openApp(Activity a, String name) {
        PackageManager pm = a.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, 0);
        String want = name.toLowerCase(Locale.ROOT).trim();
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo r : apps) {
            String label = String.valueOf(r.loadLabel(pm)).toLowerCase(Locale.ROOT);
            int score = label.equals(want) ? 3 : label.startsWith(want) ? 2 : label.contains(want) || want.contains(label) ? 1 : 0;
            if (score > bestScore) { bestScore = score; best = r; }
        }
        if (best == null) return "not_found";
        Intent go = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (go == null) return "not_found";
        a.startActivity(go.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return "ok:" + best.loadLabel(pm);
    }

    private static String start(Activity a, Intent i) {
        try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return "ok"; }
        catch (Exception e) { return "failed"; }
    }
}
