export const NotificationType = {
    ALERT: 'ALERT',
    CONFIRMATION: 'CONFIRMATION',
    EXECUTION: 'EXECUTION',
    ERROR: 'ERROR'
} as const;

export type NotificationType = typeof NotificationType[keyof typeof NotificationType];

export const sendNotification = (type: NotificationType, message: string) => {
    console.log(`[${type}] ${message}`);

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`BNB Trader - ${type}`, { body: message });
    }
};

export const requestNotificationPermission = async () => {
    if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }
    return false;
};
