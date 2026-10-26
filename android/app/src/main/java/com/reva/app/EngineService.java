package com.reva.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** Foreground engine service: holds the harness process alive so agent loops,
 *  shells and downloads keep running in the background — including after the
 *  task is swiped from recents. It stops only via the Quit action. */
public class EngineService extends Service {

    private static final String CHANNEL = "reva-engine";
    private static final int NOTIF_ID = 42;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL,
                "REVA engine", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Keeps REVA running in the background");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "quit".equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pOpen = PendingIntent.getActivity(this, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent quit = new Intent(this, EngineService.class);
        quit.setAction("quit");
        PendingIntent pQuit = PendingIntent.getService(this, 2, quit,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        Notification n = b
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .setContentTitle("REVA is running")
                .setContentText("Agent, terminal and downloads stay alive in the background.")
                .setContentIntent(pOpen)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Quit", pQuit).build())
                .build();
        startForeground(NOTIF_ID, n);
        // START_STICKY: if the system does kill us (memory pressure), come back.
        return START_STICKY;
    }

    /** Swiping the task from recents must NOT stop the engine — the whole
     *  point is that background work survives it. Only Quit stops us. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // intentionally keep running; restart if the system tore us down
        Intent restart = new Intent(getApplicationContext(), EngineService.class);
        startService(restart);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
