// Firebase設定ファイル
// 注意: このファイルにはあなたのFirebaseプロジェクトの設定を入力してください

import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Firebase設定オブジェクト
// Firebase Consoleから取得した設定値を以下に入力してください
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Firebase設定の検証
function validateFirebaseConfig() {
    const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    const missingFields = requiredFields.filter(field => 
        !firebaseConfig[field] || firebaseConfig[field].includes('YOUR_')
    );
    
    if (missingFields.length > 0) {
        console.warn('Firebase設定が不完全です。以下のフィールドを設定してください:', missingFields);
        return false;
    }
    return true;
}

// Firebase初期化
let app;
let db;
let isFirebaseConfigured = false;

try {
    if (validateFirebaseConfig()) {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        isFirebaseConfigured = true;
        console.log('Firebase初期化完了');
    } else {
        console.warn('Firebase設定が未完了のため、オフラインモードで動作します');
    }
} catch (error) {
    console.error('Firebase初期化エラー:', error);
    isFirebaseConfigured = false;
}

// エクスポート
export { db, isFirebaseConfigured };

// Firebase設定手順を表示する関数
export function showFirebaseSetupInstructions() {
    return `
Firebase設定手順:

1. Firebase Console (https://console.firebase.google.com/) にアクセス
2. 新しいプロジェクトを作成または既存のプロジェクトを選択
3. プロジェクト設定 > 全般 > マイアプリ で「ウェブアプリを追加」
4. アプリ名を入力（例: 水質調査アプリ）
5. 表示されるfirebaseConfigオブジェクトの値を firebase-config.js にコピー
6. Firestoreデータベースを有効にする:
   - 左メニューから「Firestore Database」を選択
   - 「データベースの作成」をクリック
   - セキュリティルールで「テストモードで開始」を選択（後で変更可能）

設定完了後、ページを再読み込みしてください。
`;
}

// オフライン時のデモモード設定
export const DEMO_MODE = !isFirebaseConfigured;

// デモデータ（Firebase未設定時の参考用）
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