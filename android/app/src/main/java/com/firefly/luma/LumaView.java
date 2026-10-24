package com.firefly.luma;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Luma herself on the phone, drawn live (the same as on the computer): she breathes, blinks, her hair
 * drifts and trails behind her when she moves, she leans into a glide, squashes a little when she lands,
 * nods along with her words, and a little firefly light circles her. About 30 frames a second, and
 * nothing at all while she's off screen.
 */
class LumaView extends View {
    // where her open eyes are in each picture (left, top, right, bottom), and the skin around them
    private static final Map<String, int[][]> EYES = new HashMap<>();
    private static final Map<String, Integer> SKIN = new HashMap<>();
    static {
        EYES.put("excited", new int[][]{{64, 130, 107, 176}, {148, 126, 187, 166}});
        EYES.put("listening", new int[][]{{65, 235, 135, 300}, {202, 225, 265, 288}});
        EYES.put("pout", new int[][]{{65, 148, 100, 180}, {142, 140, 180, 170}});
        EYES.put("sad", new int[][]{{67, 142, 105, 178}, {145, 137, 180, 168}});
        EYES.put("shy", new int[][]{{62, 162, 100, 188}, {140, 150, 175, 175}});
        EYES.put("ignore", new int[][]{{100, 230, 130, 290}});
        SKIN.put("excited", 0xFFFCD3CC); SKIN.put("listening", 0xFFFDD4CF); SKIN.put("pout", 0xFFFCD2CD);
        SKIN.put("sad", 0xFFFDD3CD); SKIN.put("shy", 0xFFFBC9C4); SKIN.put("ignore", 0xFFFCD3D1);
    }

    private static class Pic { Bitmap small; int natW, natH; float w, h; }
    private final Map<String, Pic> pics = new HashMap<>();
    private String mood = "happy", prev = null;
    private long fadeAt, blinkAt = -1000, nextBlink = SystemClock.uptimeMillis() + 2500, sparkAt;
    private float vx, lean, squash, hop, nod;
    private int lastX = Integer.MIN_VALUE, lastY;
    private long lastMoveAt;
    boolean flying, walking, talking, asleep;
    private final float d;   // pixels per dp
    private final float PAD;
    private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect src = new Rect();
    private final RectF dst = new RectF();
    private final Path path = new Path();
    private static class Spark { float x, y; long t; }
    private final ArrayList<Spark> sparks = new ArrayList<>();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!isAttachedToWindow()) return;
            if (getWindowVisibility() == VISIBLE && getVisibility() == VISIBLE) invalidate();
            postDelayed(this, asleep ? 80 : 33);
        }
    };

    LumaView(Context c) {
        super(c);
        d = c.getResources().getDisplayMetrics().density;
        PAD = 6 * d;
    }

    @Override protected void onAttachedToWindow() { super.onAttachedToWindow(); removeCallbacks(tick); post(tick); }
    @Override protected void onDetachedFromWindow() { removeCallbacks(tick); super.onDetachedFromWindow(); }

    void setMood(String m) {
        if (m == null || m.equals(mood)) return;
        prev = mood; mood = m; fadeAt = SystemClock.uptimeMillis();
    }
    String mood() { return mood; }
    void hop() { hop = 1; }
    void nod() { nod = 1; }
    /** Lifting off (stretch) or landing (squash). */
    void setFlying(boolean on) {
        if (on && !flying) squash = -0.7f;
        else if (!on && flying) squash = 1f;
        flying = on;
    }
    /** Where her window is now (for how fast and which way she's moving). */
    void moved(int x, int y) {
        long t = SystemClock.uptimeMillis();
        if (lastX != Integer.MIN_VALUE && t > lastMoveAt) {
            float k = Math.min(1f, (t - lastMoveAt) / 60f);
            vx += ((x - lastX) / (float) (t - lastMoveAt) * 16f / d - vx) * k;
        }
        lastX = x; lastY = y; lastMoveAt = t;
    }

    // each picture scaled to her size once, with its shadow baked in and the bottom faded (it's a bust)
    private Pic pic(String m) {
        Pic p = pics.get(m);
        if (p != null) return p;
        Bitmap raw;
        try (InputStream in = getContext().getAssets().open("luma/chibi_" + m + ".webp")) { raw = BitmapFactory.decodeStream(in); }
        catch (Exception e) { return null; }
        if (raw == null) return null;
        p = new Pic();
        p.natW = raw.getWidth(); p.natH = raw.getHeight();
        float h = getHeight() - 16 * d, w = p.natW * h / p.natH;
        if (h <= 0) return null;
        p.w = w; p.h = h;
        Bitmap b = Bitmap.createBitmap((int) (w + PAD * 2), (int) (h + PAD * 2), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint sh = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        sh.setShadowLayer(5 * d, 0, 1.5f * d, 0x8C28145A);
        c.drawBitmap(raw, null, new RectF(PAD, PAD, PAD + w, PAD + h), sh);
        Paint fade = new Paint();
        fade.setShader(new LinearGradient(0, PAD + h - 22 * d, 0, PAD + h, 0x00000000, 0xFF000000, Shader.TileMode.CLAMP));
        fade.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_OUT));
        c.drawRect(0, PAD + h - 22 * d, b.getWidth(), b.getHeight(), fade);
        raw.recycle();
        p.small = b;
        pics.put(m, p);
        return p;
    }

    private void drawPic(Canvas c, String m, float alpha, long t, float trail) {
        Pic p = pic(m);
        if (p == null) return;
        paint.setAlpha((int) (255 * alpha));
        float step = 4 * d;
        // in strips, each nudged sideways: her hair drifting, and trailing behind her when she moves
        for (float y = -PAD; y < p.h + PAD; y += step) {
            float f = Math.max(0, y / p.h);
            float dx = (float) Math.sin(t / 900.0 + f * 4) * 1.3f * d * f * f + trail * f * f;
            int sy = (int) (y + PAD), sh = (int) Math.min(step + 1, p.small.getHeight() - sy);
            if (sh <= 0) continue;
            src.set(0, sy, p.small.getWidth(), sy + sh);
            dst.set(-p.w / 2 - PAD + dx, -p.h + y, p.w / 2 + PAD + dx, -p.h + y + sh);
            c.drawBitmap(p.small, src, dst, paint);
        }
        // a blink: lids come down and back up
        int[][] eyes = EYES.get(m);
        long bt = t - blinkAt;
        if (eyes != null && bt >= 0 && bt < 170) {
            float pr = (float) Math.sin(Math.PI * bt / 170.0), kx = p.w / p.natW, ky = p.h / p.natH;
            Integer skin = SKIN.get(m);
            for (int[] e : eyes) {
                float L = -p.w / 2 + e[0] * kx, R = -p.w / 2 + e[2] * kx, T = -p.h + e[1] * ky, B = -p.h + e[3] * ky;
                float lid = T + (B - T) * 0.78f * pr, mid = (L + R) / 2;
                c.save();
                path.reset(); path.addOval(new RectF(L - 1, T, R + 1, B), Path.Direction.CW);
                c.clipPath(path);
                fill.setStyle(Paint.Style.FILL); fill.setColor(skin == null ? 0xFFFCD3CC : skin); fill.setAlpha((int) (255 * alpha));
                path.reset(); path.moveTo(L - 2, T - 2); path.lineTo(R + 2, T - 2); path.lineTo(R + 2, lid); path.quadTo(mid, lid + 3 * d * pr, L - 2, lid); path.close();
                c.drawPath(path, fill);
                c.restore();
                if (pr > 0.5f) {
                    fill.setStyle(Paint.Style.STROKE); fill.setStrokeWidth(1.2f * d); fill.setStrokeCap(Paint.Cap.ROUND); fill.setColor(0xFF2A1A22); fill.setAlpha((int) (255 * alpha));
                    path.reset(); path.moveTo(L + 2, lid); path.quadTo(mid, lid + 3 * d * pr, R - 2, lid);
                    c.drawPath(path, fill);
                }
            }
        }
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) { super.onSizeChanged(w, h, ow, oh); pics.clear(); }

    @Override protected void onDraw(Canvas c) {
        long t = SystemClock.uptimeMillis();
        int W = getWidth(), H = getHeight();
        boolean going = flying || walking;
        if (!going || t - lastMoveAt > 120) vx *= 0.85f;
        squash *= 0.86f; hop *= 0.9f; nod *= 0.86f;
        lean += ((flying ? Math.max(-0.35f, Math.min(0.35f, vx * 0.03f)) : 0) - lean) * 0.12f;
        if (t > nextBlink && !asleep && !"happy".equals(mood) && !"sleepy".equals(mood)) {
            blinkAt = t; nextBlink = t + 2200 + (long) (Math.random() * 3800) - (Math.random() < 0.2 ? 1900 : 0);
        }
        float breath = (float) Math.sin(t / 3200.0 * Math.PI * 2) * (asleep ? 1.6f : 1f);
        float y = 0, rot = (float) Math.sin(t / 2300.0) * 0.03f + lean;
        if (walking) { y -= Math.abs(Math.sin(t / 170.0)) * 4 * d; rot += Math.sin(t / 170.0) * 0.05f; }
        else if (flying) y -= (4 + (float) Math.sin(t / 140.0) * 3) * d;
        else if (!asleep) y += ((float) Math.sin(t / 1400.0) * 2.5f - 2.5f) * d;
        if (talking) { y -= Math.abs(Math.sin(t / 150.0)) * 1.5f * d; rot += Math.sin(t / 300.0) * 0.02f; }
        y -= (hop * (float) Math.sin((1 - hop) * Math.PI) * 14 + nod * 3) * d;
        rot += nod * 0.04f;

        // a soft glow she floats on (fainter when she's up in the air)
        float up = Math.min(1, Math.max(0, -y / (20 * d) + (flying ? 0.5f : 0)));
        fill.setStyle(Paint.Style.FILL);
        fill.setShader(new RadialGradient(W / 2f, H - 8 * d, 34 * d, ((int) (255 * (0.38f - up * 0.2f)) << 24) | 0xFFD68C, 0x00B48CFF, Shader.TileMode.CLAMP));
        c.save(); c.scale(1, 0.22f, W / 2f, H - 8 * d); c.drawCircle(W / 2f, H - 8 * d, 34 * d, fill); c.restore();
        fill.setShader(null);

        // her, standing on the bottom middle: breathing, squashing and stretching
        float sx = (1 + squash * 0.12f) * (1 - breath * 0.006f), sy = (1 - squash * 0.12f) * (1 + breath * 0.012f);
        c.save();
        c.translate(W / 2f, H - 8 * d + y);
        c.rotate((float) Math.toDegrees(rot));
        c.scale(sx, sy);
        float trail = Math.max(-12 * d, Math.min(12 * d, -vx * d));
        float fade = Math.min(1f, (t - fadeAt) / 200f);
        if (prev != null && fade < 1) drawPic(c, prev, 1 - fade, t, trail);
        drawPic(c, mood, prev != null && fade < 1 ? fade : 1, t, trail);
        c.restore();

        // sparkles left in the air while she glides (they stay where they were on the screen)
        if (flying && lastX != Integer.MIN_VALUE && t - sparkAt > 70) {
            sparkAt = t; Spark s = new Spark();
            s.x = lastX + W / 2f + (float) (Math.random() - 0.5) * 40 * d; s.y = lastY + H - 45 * d + (float) Math.random() * 30 * d; s.t = t;
            sparks.add(s);
        }
        for (int i = sparks.size() - 1; i >= 0; i--) {
            Spark s = sparks.get(i);
            float age = (t - s.t) / 1000f;
            if (age >= 1) { sparks.remove(i); continue; }
            fill.setColor(0xFFFFE28C); fill.setAlpha((int) (230 * (1 - age)));
            c.drawCircle(s.x - lastX, s.y - lastY + age * 12 * d, (2.2f * (1 - age) + 0.6f) * d, fill);
        }

        // her firefly: a little light circling her
        double a = t / 1600.0;
        float fx = W / 2f + (float) Math.cos(a) * 36 * d, fy = H * 0.3f + y + (float) Math.sin(a * 2) * 10 * d;
        float glow = 0.55f + 0.45f * (float) Math.sin(t / 260.0);
        fill.setShader(new RadialGradient(fx, fy, 8 * d, ((int) (255 * glow) << 24) | 0xFFEC96, 0x00FFD27A, Shader.TileMode.CLAMP));
        c.drawCircle(fx, fy, 8 * d, fill);
        fill.setShader(null);
    }
}
