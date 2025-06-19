// 水質調査データメモアプリ - スマホ対応メインスクリプト
import { db, isFirebaseConfigured, DEMO_MODE, demoData, showFirebaseSetupInstructions } from './firebase-config.js';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// アプリケーション状態
let isOnline = navigator.onLine;
let localData = [];
let pendingSync = [];
let deferredPrompt;
let isInstalled = false;

// DOM要素
const elements = {
    form: null,
    connectionStatus: null,
    connectionText: null,
    syncStatus: null,
    pendingCount: null,
    dataListContainer: null,
    tabs: null,
    tabContents: null,
    loadingOverlay: null,
    loadingMessage: null,
    toastContainer: null,
    installBanner: null,
    installButton: null,
    installClose: null
};

// PWAインストール管理
class PWAInstaller {
    constructor() {
        this.setupEventListeners();
        this.checkInstallStatus();
    }

    setupEventListeners() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            this.showInstallBanner();
        });

        window.addEventListener('appinstalled', () => {
            isInstalled = true;
            this.hideInstallBanner();
            this.updatePWAStatus();
            showToast('アプリがインストールされました！', 'success');
        });
    }

    checkInstallStatus() {
        // PWA状態をチェック
        if (window.matchMedia('(display-mode: standalone)').matches) {
            isInstalled = true;
            this.updatePWAStatus();
        } else if (window.navigator.standalone === true) {
            // iOS Safari PWA
            isInstalled = true;
            this.updatePWAStatus();
        }
    }

    showInstallBanner() {
        if (!isInstalled && elements.installBanner) {
            elements.installBanner.classList.remove('hidden');
        }
    }

    hideInstallBanner() {
        if (elements.installBanner) {
            elements.installBanner.classList.add('hidden');
        }
    }

    async installApp() {
        if (!deferredPrompt) return false;

        try {
            const result = await deferredPrompt.prompt();
            console.log('PWAインストール結果:', result.outcome);
            
            if (result.outcome === 'accepted') {
                isInstalled = true;
                this.hideInstallBanner();
            }
            
            deferredPrompt = null;
            return result.outcome === 'accepted';
        } catch (error) {
            console.error('PWAインストールエラー:', error);
            return false;
        }
    }

    updatePWAStatus() {
        const statusElement = document.getElementById('pwa-status');
        if (statusElement) {
            statusElement.textContent = isInstalled ? 'インストール済み' : '未インストール';
        }
    }
}

// タッチジェスチャー管理
class TouchManager {
    constructor() {
        this.setupTouchEvents();
    }

    setupTouchEvents() {
        // 長押し防止
        document.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return; // 入力フィールドでは長押しを許可
            }
            e.preventDefault();
        });

        // ダブルタップズーム防止
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // スワイプでタブ切り替え
        this.setupSwipeNavigation();
    }

    setupSwipeNavigation() {
        let touchStartX = 0;
        let touchEndX = 0;

        const tabContents = document.querySelectorAll('.tab-content');
        const tabs = ['data-entry', 'data-list', 'settings'];

        tabContents.forEach(content => {
            content.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            });

            content.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                this.handleSwipe(tabs);
            });
        });
    }

    handleSwipe(tabs) {
        const swipeThreshold = 100;
        const currentTab = document.querySelector('.tab-content.active').id;
        const currentIndex = tabs.indexOf(currentTab);

        if (touchEndX < touchStartX - swipeThreshold && currentIndex < tabs.length - 1) {
            // 左スワイプ：次のタブ
            showTab(tabs[currentIndex + 1]);
        } else if (touchEndX > touchStartX + swipeThreshold && currentIndex > 0) {
            // 右スワイプ：前のタブ
            showTab(tabs[currentIndex - 1]);
        }
    }
}

// GPS管理クラス
class GPSManager {
    constructor() {
        this.watchId = null;
        this.lastPosition = null;
        this.isWatching = false;
    }

    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.lastPosition = position;
                    resolve(position);
                },
                (error) => {
                    reject(error);
                },
                options
            );
        });
    }

    startWatching() {
        if (!navigator.geolocation || this.isWatching) return;

        const options = {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 300000 // 5分間キャッシュ
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.lastPosition = position;
                console.log('GPS位置更新:', position);
            },
            (error) => {
                console.warn('GPS監視エラー:', error);
            },
            options
        );

        this.isWatching = true;
    }

    stopWatching() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
            this.isWatching = false;
        }
    }
}

// バッテリー管理
class BatteryManager {
    constructor() {
        this.battery = null;
        this.init();
    }

    async init() {
        try {
            if ('getBattery' in navigator) {
                this.battery = await navigator.getBattery();
                this.setupBatteryEvents();
                this.checkBatteryLevel();
            }
        } catch (error) {
            console.log('バッテリー情報取得不可:', error);
        }
    }

    setupBatteryEvents() {
        if (!this.battery) return;

        this.battery.addEventListener('levelchange', () => {
            this.checkBatteryLevel();
        });

        this.battery.addEventListener('chargingchange', () => {
            this.checkBatteryLevel();
        });
    }

    checkBatteryLevel() {
        if (!this.battery) return;

        const level = this.battery.level * 100;
        const charging = this.battery.charging;

        if (level < 20 && !charging) {
            showToast('バッテリー残量が少なくなっています', 'warning');
            // GPS監視を停止してバッテリーを節約
            if (gpsManager.isWatching) {
                gpsManager.stopWatching();
                console.log('バッテリー節約のためGPS監視を停止');
            }
        }
    }
}

// グローバルインスタンス
let pwaInstaller;
let touchManager;
let gpsManager;
let batteryManager;

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', async () => {
    await initializeElements();
    await initializeApp();
    setupEventListeners();
    updateConnectionStatus();
    await loadLocalData();
    displayData();
    setCurrentDateTime();
    
    // スマホ対応機能の初期化
    pwaInstaller = new PWAInstaller();
    touchManager = new TouchManager();
    gpsManager = new GPSManager();
    batteryManager = new BatteryManager();
    
    // PWA状態更新
    pwaInstaller.updatePWAStatus();
    
    // Service Worker登録
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./service-worker.js');
            console.log('Service Worker登録完了');
        } catch (error) {
            console.error('Service Worker登録失敗:', error);
        }
    }

    // オンライン復帰時の自動同期
    setupAutoSync();
});

// DOM要素の初期化
function initializeElements() {
    elements.form = document.getElementById('water-quality-form');
    elements.connectionStatus = document.getElementById('connection-status');
    elements.connectionText = document.getElementById('connection-text');
    elements.syncStatus = document.getElementById('sync-status');
    elements.pendingCount = document.getElementById('pending-count');
    elements.dataListContainer = document.getElementById('data-list-container');
    elements.tabs = document.querySelectorAll('.tab-btn');
    elements.tabContents = document.querySelectorAll('.tab-content');
    elements.loadingOverlay = document.getElementById('loading-overlay');
    elements.loadingMessage = document.getElementById('loading-message');
    elements.toastContainer = document.getElementById('toast-container');
    elements.installBanner = document.getElementById('install-banner');
    elements.installButton = document.getElementById('install-button');
    elements.installClose = document.getElementById('install-close');
}

// アプリケーション初期化
async function initializeApp() {
    try {
        if (isFirebaseConfigured) {
            console.log('Firebase設定済み - オンライン機能有効');
            document.getElementById('firebase-status').textContent = '接続済み';
            document.getElementById('firebase-status').className = 'status online';
        } else {
            console.log('Firebase未設定 - オフラインモードで動作');
            document.getElementById('firebase-status').textContent = '未設定';
            document.getElementById('firebase-status').className = 'status offline';
            
            // デモデータを表示
            if (DEMO_MODE) {
                localData = [...demoData];
                console.log('デモデータをロード');
            }
        }
    } catch (error) {
        console.error('アプリ初期化エラー:', error);
    }
}

// イベントリスナーの設定
function setupEventListeners() {
    // フォーム送信
    elements.form.addEventListener('submit', handleFormSubmit);
    
    // フォームクリア
    document.getElementById('clear-form').addEventListener('click', clearForm);
    
    // GPS取得
    document.getElementById('get-location').addEventListener('click', getCurrentLocation);
    
    // データ同期
    document.getElementById('sync-data').addEventListener('click', syncData);
    
    // CSV出力
    document.getElementById('export-data').addEventListener('click', exportToCSV);
    
    // 接続テスト
    document.getElementById('test-connection').addEventListener('click', testFirebaseConnection);
    
    // ローカルデータ削除
    document.getElementById('clear-local-data').addEventListener('click', clearLocalData);
    
    // PWAインストール
    if (elements.installButton) {
        elements.installButton.addEventListener('click', async () => {
            const success = await pwaInstaller.installApp();
            if (!success) {
                showToast('インストールをキャンセルしました', 'info');
            }
        });
    }
    
    if (elements.installClose) {
        elements.installClose.addEventListener('click', () => {
            pwaInstaller.hideInstallBanner();
        });
    }
    
    // オンライン状態の監視
    window.addEventListener('online', () => {
        isOnline = true;
        updateConnectionStatus();
        showToast('オンラインに復帰しました', 'success');
        if (isFirebaseConfigured) {
            setTimeout(() => syncData(), 1000); // 1秒後に同期
        }
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateConnectionStatus();
        showToast('オフラインモードに切り替わりました', 'warning');
    });

    // ページ可視性変更の監視（バッテリー節約）
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // アプリがバックグラウンドに移行
            gpsManager.stopWatching();
        } else {
            // アプリがフォアグラウンドに復帰
            if (isOnline) {
                gpsManager.startWatching();
            }
        }
    });
}

// タブ切り替え
window.showTab = function(tabId) {
    // すべてのタブを非アクティブに
    elements.tabs.forEach(tab => tab.classList.remove('active'));
    elements.tabContents.forEach(content => content.classList.remove('active'));
    
    // 選択されたタブをアクティブに
    const targetTab = document.querySelector(`[onclick="showTab('${tabId}')"]`);
    if (targetTab) targetTab.classList.add('active');
    
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add('active');
    
    // データ一覧タブが選択された場合、データを更新
    if (tabId === 'data-list') {
        displayData();
    }
    
    // 設定タブが選択された場合、PWA状態を更新
    if (tabId === 'settings') {
        pwaInstaller.updatePWAStatus();
    }
};

// フォーム送信処理
async function handleFormSubmit(event) {
    event.preventDefault();
    
    showLoading('データを保存中...');
    
    try {
        const formData = new FormData(elements.form);
        const data = {
            id: generateId(),
            location: formData.get('location'),
            coordinates: formData.get('coordinates'),
            dateTime: formData.get('dateTime'),
            temperature: formData.get('temperature') ? parseFloat(formData.get('temperature')) : null,
            ph: formData.get('ph') ? parseFloat(formData.get('ph')) : null,
            dissolvedOxygen: formData.get('dissolvedOxygen') ? parseFloat(formData.get('dissolvedOxygen')) : null,
            turbidity: formData.get('turbidity') ? parseFloat(formData.get('turbidity')) : null,
            conductivity: formData.get('conductivity') ? parseInt(formData.get('conductivity')) : null,
            depth: formData.get('depth') ? parseFloat(formData.get('depth')) : null,
            weather: formData.get('weather'),
            notes: formData.get('notes'),
            timestamp: new Date(),
            synced: false
        };
        
        // ローカルに保存
        await saveToLocal(data);
        
        // オンラインかつFirebase設定済みの場合、即座に同期を試行
        if (isOnline && isFirebaseConfigured) {
            try {
                await saveToFirebase(data);
                data.synced = true;
                await updateLocalData(data);
                showToast('データを保存し、Firebaseに同期しました', 'success');
            } catch (error) {
                console.error('Firebase同期エラー:', error);
                pendingSync.push(data.id);
                showToast('データを保存しました（後で同期されます）', 'warning');
            }
        } else {
            pendingSync.push(data.id);
            showToast('データを保存しました（オフライン）', 'info');
        }
        
        updateSyncStatus();
        clearForm();
        
        // データ一覧が表示されている場合は更新
        if (document.getElementById('data-list').classList.contains('active')) {
            displayData();
        }
        
    } catch (error) {
        console.error('データ保存エラー:', error);
        showToast('データ保存中にエラーが発生しました', 'error');
    } finally {
        hideLoading();
    }
}

// GPS位置情報取得
async function getCurrentLocation() {
    const button = document.getElementById('get-location');
    const coordinatesInput = document.getElementById('coordinates');
    
    if (!navigator.geolocation) {
        showToast('お使いのデバイスではGPS機能がサポートされていません', 'error');
        return;
    }
    
    button.innerHTML = '<div class="loading-spinner" style="width: 16px; height: 16px;"></div>';
    button.disabled = true;
    
    try {
        showLoading('GPS位置情報を取得中...');
        const position = await gpsManager.getCurrentPosition();
        
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        coordinatesInput.value = `${lat}, ${lng}`;
        
        const accuracy = position.coords.accuracy;
        showToast(`GPS位置情報を取得しました（精度: ${Math.round(accuracy)}m）`, 'success');
        
    } catch (error) {
        console.error('GPS取得エラー:', error);
        
        let message = 'GPS位置情報の取得に失敗しました';
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = 'GPS位置情報の使用が許可されていません';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'GPS位置情報が取得できません';
                break;
            case error.TIMEOUT:
                message = 'GPS位置情報の取得がタイムアウトしました';
                break;
        }
        showToast(message, 'error');
    } finally {
        button.innerHTML = '📍 GPS';
        button.disabled = false;
        hideLoading();
    }
}

// ローディング表示
function showLoading(message = '処理中...') {
    if (elements.loadingOverlay && elements.loadingMessage) {
        elements.loadingMessage.textContent = message;
        elements.loadingOverlay.classList.remove('hidden');
    }
}

// ローディング非表示
function hideLoading() {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.add('hidden');
    }
}

// トースト通知表示
function showToast(message, type = 'info') {
    if (!elements.toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    elements.toastContainer.appendChild(toast);
    
    // 自動削除
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 4000);
}

// 自動同期の設定
function setupAutoSync() {
    // ページ表示時に自動同期
    if (isOnline && isFirebaseConfigured && pendingSync.length > 0) {
        setTimeout(() => {
            syncData();
        }, 2000);
    }
    
    // 定期的な同期チェック（5分間隔）
    setInterval(() => {
        if (isOnline && isFirebaseConfigured && pendingSync.length > 0) {
            syncData();
        }
    }, 5 * 60 * 1000);
}

// 既存の関数は同じ機能を維持
// (saveToLocal, saveToFirebase, loadLocalData, etc. - 前回のものと同じ)

// [ここに前回作成した関数群を含める - 文字数制限のため省略]

// 接続状態更新
function updateConnectionStatus() {
    const status = elements.connectionStatus;
    const text = elements.connectionText;
    
    if (isOnline) {
        text.textContent = 'オンライン';
        status.className = 'status online';
    } else {
        text.textContent = 'オフライン';
        status.className = 'status offline';
    }
}

// 同期状態更新
function updateSyncStatus() {
    if (elements.pendingCount) {
        elements.pendingCount.textContent = pendingSync.length;
    }
}

// 現在日時設定
function setCurrentDateTime() {
    const now = new Date();
    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    document.getElementById('date-time').value = localDateTime;
}

// フォームクリア
function clearForm() {
    elements.form.reset();
    setCurrentDateTime();
}

// ユーティリティ関数
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
} 