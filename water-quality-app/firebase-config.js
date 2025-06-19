// ローカル専用水質調査アプリ設定
// Firebase機能を削除し、完全ローカル動作に特化

// ローカル専用モードの設定
export const isFirebaseConfigured = false;
export const DEMO_MODE = true;
export const db = null;

// デモデータ（初回起動時の参考用）
export const demoData = [
    {
        id: 'demo1',
        location: '多摩川河口',
        coordinates: '35.5533, 139.7581',
        dateTime: '2024-03-15T10:30',
        temperature: 18.5,
        ph: 7.2,
        dissolvedOxygen: 8.3,
        turbidity: 2.1,
        conductivity: 320,
        depth: 1.5,
        weather: '晴れ',
        notes: 'サンプル調査データ（デモ）',
        synced: false,
        timestamp: new Date('2024-03-15T10:30:00')
    },
    {
        id: 'demo2',
        location: '荒川中流域',
        coordinates: '35.7061, 139.7814',
        dateTime: '2024-03-15T14:15',
        temperature: 19.2,
        ph: 7.5,
        dissolvedOxygen: 7.8,
        turbidity: 3.2,
        conductivity: 285,
        depth: 2.1,
        weather: '曇り',
        notes: '上流からの流入確認',
        synced: false,
        timestamp: new Date('2024-03-15T14:15:00')
    }
];

// アプリケーション情報
export const APP_INFO = {
    name: '水質調査データメモ',
    version: '2.0.0',
    description: 'オフライン専用水質調査データ記録アプリ',
    storageType: 'IndexedDB (ローカル)',
    features: [
        '完全オフライン動作',
        'GPS位置情報取得',
        'データローカル保存',
        'CSV出力機能',
        'PWA対応'
    ]
};

console.log('ローカル専用モードで初期化完了'); 