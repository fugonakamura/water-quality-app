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

// IndexedDB 管理
class LocalDataManager {
    constructor() {
        this.dbName = 'WaterQualityDB';
        this.dbVersion = 1;
        this.storeName = 'measurements';
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                }
            };
        });
    }

    async save(data) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clear() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// グローバルインスタンス
let localDataManager;
let pwaInstaller;
let touchManager;
let gpsManager;
let batteryManager;

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

    updateEnvironmentInfo() {
        // 環境情報の更新
        const envInfo = document.getElementById('environment-info');
        const codespacesNotice = document.getElementById('codespaces-notice');
        const gpsStatus = document.getElementById('gps-status');
        
        if (envInfo) {
            if (gpsManager?.isCodespaces) {
                envInfo.textContent = 'GitHub Codespaces';
                envInfo.className = 'status warning';
                if (codespacesNotice) {
                    codespacesNotice.classList.remove('hidden');
                }
            } else {
                envInfo.textContent = 'ローカル環境';
                envInfo.className = 'status online';
            }
        }
        
        if (gpsStatus) {
            if (gpsManager?.isCodespaces) {
                gpsStatus.textContent = '手動入力のみ';
            } else if (navigator.geolocation) {
                gpsStatus.textContent = '利用可能';
            } else {
                gpsStatus.textContent = '未対応';
            }
        }
        
        // データ件数の更新
        this.updateDataCount();
    }

    updateDataCount() {
        const dataCount = document.getElementById('data-count');
        if (dataCount && localData) {
            dataCount.textContent = `${localData.length}件`;
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

// GPS管理クラス（Codespaces対応版）
class GPSManager {
    constructor() {
        this.watchId = null;
        this.lastPosition = null;
        this.isWatching = false;
        this.isCodespaces = this.detectCodespaces();
    }

    detectCodespaces() {
        // GitHub Codespacesの検出
        return window.location.hostname.includes('app.github.dev') || 
               window.location.hostname.includes('codespaces');
    }

    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            // Codespacesの場合は代替方法を提案
            if (this.isCodespaces) {
                showToast('Codespacesでは位置情報取得できません。手動で座標を入力してください', 'warning');
                reject(new Error('Geolocation not available in Codespaces'));
                return;
            }

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
        if (this.isCodespaces || !navigator.geolocation || this.isWatching) return;

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

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initializeElements();
        
        // データマネージャーの初期化
        localDataManager = new LocalDataManager();
        await localDataManager.init();
        
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
        
        console.log('アプリ初期化完了');
        showToast('アプリが正常に起動しました', 'success');
        
    } catch (error) {
        console.error('アプリ初期化エラー:', error);
        showToast('アプリの初期化中にエラーが発生しました', 'error');
    }
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
                // デモデータをローカルに保存
                for (const data of demoData) {
                    await localDataManager.save(data);
                }
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
    elements.form?.addEventListener('submit', handleFormSubmit);
    
    // フォームクリア
    document.getElementById('clear-form')?.addEventListener('click', clearForm);
    
    // GPS取得
    document.getElementById('get-location')?.addEventListener('click', getCurrentLocation);
    
    // データ同期
    document.getElementById('sync-data')?.addEventListener('click', syncData);
    
    // CSV出力
    document.getElementById('export-data')?.addEventListener('click', exportToCSV);
    
    // 接続テスト
    document.getElementById('test-connection')?.addEventListener('click', testFirebaseConnection);
    
    // ローカルデータ削除
    document.getElementById('clear-local-data')?.addEventListener('click', clearLocalData);
    
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
            gpsManager?.stopWatching();
        } else {
            // アプリがフォアグラウンドに復帰
            if (isOnline) {
                gpsManager?.startWatching();
            }
        }
    });
}

// タブ切り替え
window.showTab = function(tabId) {
    // すべてのタブを非アクティブに
    elements.tabs?.forEach(tab => tab.classList.remove('active'));
    elements.tabContents?.forEach(content => content.classList.remove('active'));
    
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
        pwaInstaller?.updatePWAStatus();
        pwaInstaller?.updateEnvironmentInfo();
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
        if (document.getElementById('data-list')?.classList.contains('active')) {
            displayData();
        }
        
    } catch (error) {
        console.error('データ保存エラー:', error);
        showToast('データ保存中にエラーが発生しました: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ローカルデータ保存
async function saveToLocal(data) {
    try {
        await localDataManager.save(data);
        console.log('ローカルデータ保存完了:', data.id);
    } catch (error) {
        console.error('ローカルデータ保存エラー:', error);
        throw error;
    }
}

// Firebase保存
async function saveToFirebase(data) {
    if (!isFirebaseConfigured || !db) {
        throw new Error('Firebase未設定');
    }
    
    try {
        const docRef = await addDoc(collection(db, 'waterQualityData'), data);
        console.log('Firebase保存完了:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Firebase保存エラー:', error);
        throw error;
    }
}

// ローカルデータ読み込み
async function loadLocalData() {
    try {
        localData = await localDataManager.getAll();
        console.log('ローカルデータ読み込み完了:', localData.length + '件');
        
        // 未同期データの確認
        pendingSync = localData.filter(item => !item.synced).map(item => item.id);
        updateSyncStatus();
        
    } catch (error) {
        console.error('ローカルデータ読み込みエラー:', error);
        localData = [];
    }
}

// ローカルデータ更新
async function updateLocalData(data) {
    try {
        await localDataManager.save(data);
        await loadLocalData();
    } catch (error) {
        console.error('ローカルデータ更新エラー:', error);
    }
}

// データ表示
function displayData() {
    const container = elements.dataListContainer;
    if (!container) return;
    
    if (!localData || localData.length === 0) {
        container.innerHTML = '<p class="no-data">📭 データがありません</p>';
        // データ件数の更新
        pwaInstaller?.updateDataCount();
        return;
    }
    
    // データを日時順でソート（新しい順）
    const sortedData = [...localData].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    container.innerHTML = sortedData.map(item => `
        <div class="data-item ${item.synced ? 'synced' : 'pending'}">
            <div class="data-item-header">
                <div class="data-item-location">${item.location || '未記録'}</div>
                <div class="data-item-date">${formatDateTime(item.dateTime || item.timestamp)}</div>
            </div>
            <div class="data-item-values">
                ${item.temperature !== null ? `<div class="data-value"><span class="data-value-label">水温</span>${item.temperature}°C</div>` : ''}
                ${item.ph !== null ? `<div class="data-value"><span class="data-value-label">pH</span>${item.ph}</div>` : ''}
                ${item.dissolvedOxygen !== null ? `<div class="data-value"><span class="data-value-label">溶存酸素</span>${item.dissolvedOxygen} mg/L</div>` : ''}
                ${item.turbidity !== null ? `<div class="data-value"><span class="data-value-label">濁度</span>${item.turbidity} NTU</div>` : ''}
                ${item.conductivity !== null ? `<div class="data-value"><span class="data-value-label">電気伝導度</span>${item.conductivity} μS/cm</div>` : ''}
                ${item.depth !== null ? `<div class="data-value"><span class="data-value-label">水深</span>${item.depth} m</div>` : ''}
            </div>
            ${item.coordinates ? `<div class="data-item-coordinates">📍 ${item.coordinates}</div>` : ''}
            ${item.weather ? `<div class="data-item-weather">☀️ ${item.weather}</div>` : ''}
            ${item.notes ? `<div class="data-item-notes">${item.notes}</div>` : ''}
        </div>
    `).join('');
    
    // データ件数の更新
    pwaInstaller?.updateDataCount();
}

// 日時フォーマット
function formatDateTime(dateTime) {
    try {
        const date = new Date(dateTime);
        return date.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return '日時不明';
    }
}

// データ同期
async function syncData() {
    if (!isFirebaseConfigured || !isOnline) {
        showToast('Firebase未設定またはオフライン状態です', 'warning');
        return;
    }
    
    showLoading('データを同期中...');
    
    try {
        const unsyncedData = localData.filter(item => !item.synced);
        let syncedCount = 0;
        
        for (const data of unsyncedData) {
            try {
                await saveToFirebase(data);
                data.synced = true;
                await updateLocalData(data);
                syncedCount++;
            } catch (error) {
                console.error('個別データ同期エラー:', data.id, error);
            }
        }
        
        await loadLocalData();
        displayData();
        
        if (syncedCount > 0) {
            showToast(`${syncedCount}件のデータを同期しました`, 'success');
        } else {
            showToast('同期するデータがありません', 'info');
        }
        
    } catch (error) {
        console.error('データ同期エラー:', error);
        showToast('データ同期中にエラーが発生しました', 'error');
    } finally {
        hideLoading();
    }
}

// CSV出力
function exportToCSV() {
    if (!localData || localData.length === 0) {
        showToast('出力するデータがありません', 'warning');
        return;
    }
    
    try {
        // CSV ヘッダー
        const headers = [
            '調査地点', '座標', '調査日時', '水温(°C)', 'pH', '溶存酸素(mg/L)', 
            '濁度(NTU)', '電気伝導度(μS/cm)', '水深(m)', '天候', 'メモ', '保存日時'
        ];
        
        // CSV データ
        const csvData = localData.map(item => [
            item.location || '',
            item.coordinates || '',
            item.dateTime || '',
            item.temperature || '',
            item.ph || '',
            item.dissolvedOxygen || '',
            item.turbidity || '',
            item.conductivity || '',
            item.depth || '',
            item.weather || '',
            item.notes || '',
            formatDateTime(item.timestamp)
        ]);
        
        // CSV 形式に変換
        const csvContent = [headers, ...csvData]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');
        
        // ダウンロード
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `water_quality_data_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('CSVファイルをダウンロードしました', 'success');
        
    } catch (error) {
        console.error('CSV出力エラー:', error);
        showToast('CSV出力中にエラーが発生しました', 'error');
    }
}

// Firebase接続テスト
async function testFirebaseConnection() {
    if (!isFirebaseConfigured) {
        showToast('Firebase設定が完了していません', 'warning');
        document.getElementById('firebase-status').textContent = '未設定';
        document.getElementById('firebase-status').className = 'status offline';
        return;
    }
    
    showLoading('Firebase接続テスト中...');
    
    try {
        // テストデータでの書き込みテスト
        const testData = {
            test: true,
            timestamp: new Date(),
            message: 'Connection test'
        };
        
        await addDoc(collection(db, 'connectionTest'), testData);
        
        document.getElementById('firebase-status').textContent = '接続済み';
        document.getElementById('firebase-status').className = 'status online';
        showToast('Firebase接続テスト成功', 'success');
        
    } catch (error) {
        console.error('Firebase接続テストエラー:', error);
        document.getElementById('firebase-status').textContent = '接続エラー';
        document.getElementById('firebase-status').className = 'status offline';
        showToast('Firebase接続テスト失敗: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ローカルデータ削除
async function clearLocalData() {
    if (!confirm('ローカルに保存されたすべてのデータを削除しますか？\n※ この操作は取り消せません')) {
        return;
    }
    
    showLoading('ローカルデータを削除中...');
    
    try {
        await localDataManager.clear();
        localData = [];
        pendingSync = [];
        updateSyncStatus();
        displayData();
        
        showToast('ローカルデータを削除しました', 'success');
        
    } catch (error) {
        console.error('ローカルデータ削除エラー:', error);
        showToast('ローカルデータ削除中にエラーが発生しました', 'error');
    } finally {
        hideLoading();
    }
}

// GPS位置情報取得
async function getCurrentLocation() {
    const button = document.getElementById('get-location');
    const coordinatesInput = document.getElementById('coordinates');
    
    if (!button || !coordinatesInput) return;
    
    // Codespacesの場合は手動入力を提案
    if (gpsManager.isCodespaces) {
        showToast('Codespacesでは位置情報取得できません', 'warning');
        
        // 東京の座標を例として表示
        const demoCoordinates = '35.6762, 139.6503';
        coordinatesInput.value = demoCoordinates;
        coordinatesInput.placeholder = '例: 35.6762, 139.6503 (東京駅)';
        coordinatesInput.readOnly = false;
        
        showToast('手動で座標を入力してください（例: 東京駅の座標を設定）', 'info');
        return;
    }
    
    if (!navigator.geolocation) {
        showToast('お使いのブラウザではGPS機能がサポートされていません', 'error');
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
        
        // 手動入力を促す
        coordinatesInput.readOnly = false;
        coordinatesInput.placeholder = '手動で座標を入力 (例: 35.6762, 139.6503)';
        
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

// 接続状態更新
function updateConnectionStatus() {
    const status = elements.connectionStatus;
    const text = elements.connectionText;
    
    if (status && text) {
        if (isOnline) {
            text.textContent = 'オンライン';
            status.className = 'status online';
        } else {
            text.textContent = 'オフライン';
            status.className = 'status offline';
        }
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
    const dateTimeInput = document.getElementById('date-time');
    if (dateTimeInput) {
        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        dateTimeInput.value = localDateTime;
    }
}

// フォームクリア
function clearForm() {
    if (elements.form) {
        elements.form.reset();
        setCurrentDateTime();
        
        // 座標フィールドを読み取り専用に戻す
        const coordinatesInput = document.getElementById('coordinates');
        if (coordinatesInput && !gpsManager.isCodespaces) {
            coordinatesInput.readOnly = true;
            coordinatesInput.placeholder = 'GPS取得ボタンを押してください';
        }
    }
}

// ユーティリティ関数
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
} 