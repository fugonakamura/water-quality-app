// 水質調査データメモアプリ - ローカル専用版
import { isFirebaseConfigured, DEMO_MODE, demoData, APP_INFO } from './firebase-config.js';

// アプリケーション状態
let isOnline = navigator.onLine;
let localData = [];
let deferredPrompt;
let isInstalled = false;

// DOM要素
const elements = {
    form: null,
    connectionStatus: null,
    connectionText: null,
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

// IndexedDB 管理（エラー耐性強化版）
class LocalDataManager {
    constructor() {
        this.dbName = 'WaterQualityDB';
        this.dbVersion = 1;
        this.storeName = 'measurements';
        this.db = null;
        this.fallbackStorage = []; // フォールバック用メモリストレージ
        this.useFallback = false;
        this.storageType = 'Unknown';
    }

    async init() {
        try {
            // IndexedDBの利用可能性をチェック
            if (!window.indexedDB) {
                throw new Error('IndexedDB not supported');
            }

            await this.initIndexedDB();
            this.storageType = 'IndexedDB';
            console.log('IndexedDB初期化完了');

        } catch (error) {
            console.warn('IndexedDB初期化失敗、フォールバックを使用:', error);
            await this.initFallbackStorage();
        }

        return this.db || 'fallback';
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('IndexedDB接続エラー:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.useFallback = false;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 既存のストアがある場合は削除して再作成
                if (db.objectStoreNames.contains(this.storeName)) {
                    db.deleteObjectStore(this.storeName);
                }
                
                const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('location', 'location', { unique: false });
                store.createIndex('synced', 'synced', { unique: false });
            };

            // タイムアウト設定（10秒）
            setTimeout(() => {
                if (request.readyState === 'pending') {
                    reject(new Error('IndexedDB初期化タイムアウト'));
                }
            }, 10000);
        });
    }

    async initFallbackStorage() {
        try {
            // localStorage を試行
            const testKey = 'test_storage_' + Date.now();
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            
            this.storageType = 'localStorage';
            this.useFallback = true;
            
            // 既存のlocalStorageデータを読み込み
            const existing = localStorage.getItem('waterQualityData');
            if (existing) {
                this.fallbackStorage = JSON.parse(existing);
            }
            
            console.log('localStorage初期化完了');
            
        } catch (error) {
            console.warn('localStorage使用不可、メモリストレージを使用:', error);
            this.storageType = 'Memory';
            this.useFallback = true;
            this.fallbackStorage = [];
        }
    }

    async save(data) {
        try {
            // データの妥当性チェック
            if (!data || !data.id) {
                throw new Error('無効なデータ: IDが必要です');
            }

            // タイムスタンプを確実に設定
            if (!data.timestamp) {
                data.timestamp = new Date();
            }

            if (this.useFallback) {
                return await this.saveFallback(data);
            } else {
                return await this.saveIndexedDB(data);
            }

        } catch (error) {
            console.error('データ保存エラー、フォールバックを試行:', error);
            return await this.saveFallback(data);
        }
    }

    async saveIndexedDB(data) {
        if (!this.db) {
            throw new Error('IndexedDB未初期化');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(data);
            
            transaction.oncomplete = () => {
                console.log('IndexedDBに保存完了:', data.id);
                resolve(data);
            };
            
            transaction.onerror = () => {
                console.error('IndexedDB保存エラー:', transaction.error);
                reject(transaction.error);
            };

            request.onerror = () => {
                console.error('IndexedDBリクエストエラー:', request.error);
                reject(request.error);
            };

            // タイムアウト設定
            setTimeout(() => {
                if (transaction.readyState === 'pending') {
                    reject(new Error('IndexedDB保存タイムアウト'));
                }
            }, 5000);
        });
    }

    async saveFallback(data) {
        try {
            // メモリストレージに保存
            const existingIndex = this.fallbackStorage.findIndex(item => item.id === data.id);
            if (existingIndex >= 0) {
                this.fallbackStorage[existingIndex] = data;
            } else {
                this.fallbackStorage.push(data);
            }

            // localStorageが利用可能な場合は同期
            if (this.storageType === 'localStorage') {
                localStorage.setItem('waterQualityData', JSON.stringify(this.fallbackStorage));
            }

            console.log(`${this.storageType}に保存完了:`, data.id);
            return data;

        } catch (error) {
            console.error('フォールバック保存エラー:', error);
            // メモリストレージにだけでも保存
            const existingIndex = this.fallbackStorage.findIndex(item => item.id === data.id);
            if (existingIndex >= 0) {
                this.fallbackStorage[existingIndex] = data;
            } else {
                this.fallbackStorage.push(data);
            }
            return data;
        }
    }

    async getAll() {
        try {
            if (this.useFallback) {
                return this.getAllFallback();
            } else {
                return await this.getAllIndexedDB();
            }
        } catch (error) {
            console.error('データ読み込みエラー、フォールバックを試行:', error);
            return this.getAllFallback();
        }
    }

    async getAllIndexedDB() {
        if (!this.db) {
            throw new Error('IndexedDB未初期化');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const results = request.result || [];
                console.log('IndexedDBから読み込み完了:', results.length + '件');
                resolve(results);
            };
            
            request.onerror = () => {
                console.error('IndexedDB読み込みエラー:', request.error);
                reject(request.error);
            };

            // タイムアウト設定
            setTimeout(() => {
                if (request.readyState === 'pending') {
                    reject(new Error('IndexedDB読み込みタイムアウト'));
                }
            }, 5000);
        });
    }

    getAllFallback() {
        try {
            // localStorageから最新データを読み込み
            if (this.storageType === 'localStorage') {
                const stored = localStorage.getItem('waterQualityData');
                if (stored) {
                    this.fallbackStorage = JSON.parse(stored);
                }
            }

            console.log(`${this.storageType}から読み込み完了:`, this.fallbackStorage.length + '件');
            return this.fallbackStorage;

        } catch (error) {
            console.error('フォールバック読み込みエラー:', error);
            return this.fallbackStorage || [];
        }
    }

    async delete(id) {
        try {
            if (this.useFallback) {
                return this.deleteFallback(id);
            } else {
                return await this.deleteIndexedDB(id);
            }
        } catch (error) {
            console.error('データ削除エラー、フォールバックを試行:', error);
            return this.deleteFallback(id);
        }
    }

    async deleteIndexedDB(id) {
        if (!this.db) {
            throw new Error('IndexedDB未初期化');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            
            transaction.oncomplete = () => {
                console.log('IndexedDBから削除完了:', id);
                resolve(true);
            };
            
            transaction.onerror = () => {
                console.error('IndexedDB削除エラー:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    deleteFallback(id) {
        try {
            this.fallbackStorage = this.fallbackStorage.filter(item => item.id !== id);
            
            if (this.storageType === 'localStorage') {
                localStorage.setItem('waterQualityData', JSON.stringify(this.fallbackStorage));
            }
            
            console.log(`${this.storageType}から削除完了:`, id);
            return true;
        } catch (error) {
            console.error('フォールバック削除エラー:', error);
            return false;
        }
    }

    async clear() {
        try {
            if (this.useFallback) {
                return this.clearFallback();
            } else {
                return await this.clearIndexedDB();
            }
        } catch (error) {
            console.error('データクリアエラー、フォールバックを試行:', error);
            return this.clearFallback();
        }
    }

    async clearIndexedDB() {
        if (!this.db) {
            throw new Error('IndexedDB未初期化');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            
            transaction.oncomplete = () => {
                console.log('IndexedDBクリア完了');
                resolve(true);
            };
            
            transaction.onerror = () => {
                console.error('IndexedDBクリアエラー:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    clearFallback() {
        try {
            this.fallbackStorage = [];
            
            if (this.storageType === 'localStorage') {
                localStorage.removeItem('waterQualityData');
            }
            
            console.log(`${this.storageType}クリア完了`);
            return true;
        } catch (error) {
            console.error('フォールバッククリアエラー:', error);
            this.fallbackStorage = [];
            return true; // メモリだけでもクリアできればOK
        }
    }

    getStorageInfo() {
        return {
            type: this.storageType,
            useFallback: this.useFallback,
            dataCount: this.fallbackStorage.length,
            supported: {
                indexedDB: !!window.indexedDB,
                localStorage: !!window.localStorage
            }
        };
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

// GPS管理クラス（エラー耐性強化版）
class GPSManager {
    constructor() {
        this.watchId = null;
        this.lastPosition = null;
        this.isWatching = false;
        this.isCodespaces = this.detectCodespaces();
        this.fallbackCoordinates = [
            { name: '東京駅', coords: '35.6762, 139.6503' },
            { name: '新宿駅', coords: '35.6896, 139.7006' },
            { name: '渋谷駅', coords: '35.6580, 139.7016' },
            { name: '大阪駅', coords: '34.7024, 135.4959' },
            { name: '京都駅', coords: '34.9858, 135.7581' }
        ];
        this.setupCoordinatesInput();
    }

    detectCodespaces() {
        // GitHub Codespacesや制限環境の検出
        return window.location.hostname.includes('app.github.dev') || 
               window.location.hostname.includes('codespaces') ||
               window.location.hostname.includes('localhost') ||
               !navigator.geolocation;
    }

    setupCoordinatesInput() {
        // 座標入力フィールドを常に手動入力可能にする
        setTimeout(() => {
            const coordinatesInput = document.getElementById('coordinates');
            if (coordinatesInput) {
                coordinatesInput.readOnly = false;
                coordinatesInput.placeholder = '手動入力または GPS取得 (例: 35.6762, 139.6503)';
                
                // フォーカス時のヘルプ表示
                coordinatesInput.addEventListener('focus', () => {
                    this.showCoordinateHelp();
                });
                
                // 入力値の自動バリデーション
                coordinatesInput.addEventListener('input', (e) => {
                    this.validateCoordinates(e.target.value);
                });
            }
        }, 100);
    }

    showCoordinateHelp() {
        const existingHelp = document.getElementById('coordinate-help-popup');
        if (existingHelp) return;

        const popup = document.createElement('div');
        popup.id = 'coordinate-help-popup';
        popup.className = 'coordinate-help-popup';
        popup.innerHTML = `
            <div class="help-content">
                <h4>📍 座標入力ヘルプ</h4>
                <div class="help-tabs">
                    <button class="help-tab active" onclick="showHelpTab('manual')">手動入力</button>
                    <button class="help-tab" onclick="showHelpTab('examples')">例</button>
                    <button class="help-tab" onclick="showHelpTab('maps')">Maps連携</button>
                </div>
                <div id="help-manual" class="help-tab-content active">
                    <p><strong>形式:</strong> 緯度, 経度</p>
                    <p><strong>例:</strong> 35.6762, 139.6503</p>
                    <p>※ 小数点以下4桁以上推奨</p>
                </div>
                <div id="help-examples" class="help-tab-content">
                    ${this.fallbackCoordinates.map(item => 
                        `<button class="coord-example" onclick="setCoordinates('${item.coords}')">${item.name}: ${item.coords}</button>`
                    ).join('')}
                </div>
                <div id="help-maps" class="help-tab-content">
                    <ol>
                        <li>Google Mapsで調査地点を表示</li>
                        <li>地点を右クリック</li>
                        <li>「座標をコピー」を選択</li>
                        <li>このフィールドにペースト</li>
                    </ol>
                </div>
                <button class="help-close" onclick="closeCoordinateHelp()">×</button>
            </div>
        `;

        document.body.appendChild(popup);

        // 3秒後に自動非表示
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 10000);
    }

    validateCoordinates(value) {
        const coordinatesInput = document.getElementById('coordinates');
        if (!coordinatesInput) return false;

        // 空の場合はOK
        if (!value.trim()) {
            coordinatesInput.style.borderColor = '#e0e0e0';
            return true;
        }

        // 座標形式の正規表現チェック
        const coordPattern = /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/;
        const isValid = coordPattern.test(value.trim());

        if (isValid) {
            const [lat, lng] = value.split(',').map(v => parseFloat(v.trim()));
            const isValidRange = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
            
            if (isValidRange) {
                coordinatesInput.style.borderColor = '#4CAF50';
                return true;
            }
        }

        coordinatesInput.style.borderColor = '#f44336';
        return false;
    }

    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            // 制限環境の場合は即座にフォールバック
            if (this.isCodespaces || !navigator.geolocation) {
                this.handleLocationFallback();
                reject(new Error('位置情報取得機能が利用できません'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 10000, // タイムアウト短縮
                maximumAge: 300000 // 5分間キャッシュ
            };

            // 位置情報取得を試行
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.lastPosition = position;
                    resolve(position);
                },
                (error) => {
                    console.warn('GPS取得エラー:', error);
                    this.handleLocationError(error);
                    reject(error);
                },
                options
            );
        });
    }

    handleLocationError(error) {
        let message = '';
        let suggestion = '';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '位置情報の使用が拒否されました';
                suggestion = '手動で座標を入力してください';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '位置情報が取得できません';
                suggestion = '手動入力または例座標を使用してください';
                break;
            case error.TIMEOUT:
                message = '位置情報の取得がタイムアウトしました';
                suggestion = '手動入力を試してください';
                break;
            default:
                message = '位置情報取得に失敗しました';
                suggestion = '手動入力をご利用ください';
        }

        showToast(message + ' - ' + suggestion, 'warning');
        this.handleLocationFallback();
    }

    handleLocationFallback() {
        const coordinatesInput = document.getElementById('coordinates');
        if (!coordinatesInput) return;

        // 手動入力を促す
        coordinatesInput.readOnly = false;
        coordinatesInput.focus();
        coordinatesInput.placeholder = '手動で座標を入力してください (例: 35.6762, 139.6503)';
        
        // ヘルプを表示
        this.showCoordinateHelp();
        
        showToast('座標を手動で入力してください。右上のヘルプをご参照ください', 'info');
    }

    startWatching() {
        // エラー環境では監視を開始しない
        if (this.isCodespaces || !navigator.geolocation || this.isWatching) return;

        const options = {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 300000
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.lastPosition = position;
                console.log('GPS位置更新:', position);
            },
            (error) => {
                console.warn('GPS監視エラー:', error);
                this.stopWatching(); // エラー時は監視停止
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

        console.log('アプリ初期化完了');
        showToast('ローカル専用アプリが正常に起動しました', 'success');
        
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
        console.log('ローカル専用モードで動作');
        
        // ストレージ情報を設定画面に表示
        updateStorageInfo();
        
        // デモデータの初期化チェック
        const existingData = await localDataManager.getAll();
        if (existingData.length === 0 && DEMO_MODE) {
            console.log('デモデータを初期化中...');
            let loadedCount = 0;
            
            for (const data of demoData) {
                try {
                    await localDataManager.save(data);
                    loadedCount++;
                } catch (error) {
                    console.warn('デモデータ保存エラー:', data.id, error);
                }
            }
            
            if (loadedCount > 0) {
                console.log(`デモデータ ${loadedCount}件をロード完了`);
                showToast(`${loadedCount}件のサンプルデータを追加しました`, 'info');
            }
        }
        
        // アプリ情報を設定タブに表示
        updateAppInfo();
        
    } catch (error) {
        console.error('アプリ初期化エラー:', error);
        showToast('アプリの初期化中に問題が発生しました', 'warning');
    }
}

// ストレージ情報の更新
function updateStorageInfo() {
    try {
        const storageInfo = localDataManager.getStorageInfo();
        
        // 環境情報の更新
        const envInfo = document.getElementById('environment-info');
        if (envInfo) {
            envInfo.textContent = storageInfo.type;
            envInfo.className = storageInfo.type === 'IndexedDB' ? 'status online' : 'status warning';
        }
        
        // ストレージ詳細情報の表示
        const storageDetailElement = document.querySelector('.storage-detail');
        if (storageDetailElement) {
            storageDetailElement.remove();
        }
        
        const storageGroup = document.querySelector('.settings-group h3');
        if (storageGroup && storageGroup.textContent.includes('ストレージ情報')) {
            const detailDiv = document.createElement('div');
            detailDiv.className = 'storage-detail';
            detailDiv.innerHTML = `
                <div class="storage-status">
                    <p><strong>使用中のストレージ:</strong> ${storageInfo.type}</p>
                    <p><strong>対応状況:</strong></p>
                    <ul>
                        <li>IndexedDB: ${storageInfo.supported.indexedDB ? '✅ 対応' : '❌ 未対応'}</li>
                        <li>localStorage: ${storageInfo.supported.localStorage ? '✅ 対応' : '❌ 未対応'}</li>
                    </ul>
                    ${storageInfo.useFallback ? 
                        '<p class="fallback-notice">⚠️ フォールバックモードで動作中</p>' : 
                        '<p class="normal-notice">✅ 正常動作中</p>'
                    }
                </div>
            `;
            
            storageGroup.parentNode.insertBefore(detailDiv, storageGroup.nextSibling);
        }
        
    } catch (error) {
        console.error('ストレージ情報更新エラー:', error);
    }
}

// 自動同期の設定を削除し、代わりにアプリ情報の更新関数を追加
function updateAppInfo() {
    try {
        // バージョン情報の更新
        const versionElements = document.querySelectorAll('.setting-item');
        versionElements.forEach(element => {
            const spans = element.querySelectorAll('span');
            if (spans.length === 2 && spans[0].textContent === 'バージョン') {
                spans[1].textContent = APP_INFO.version;
            }
        });
        
        // ストレージ情報の更新
        updateStorageInfo();
        
    } catch (error) {
        console.error('アプリ情報更新エラー:', error);
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
    
    // CSV出力
    document.getElementById('export-data')?.addEventListener('click', exportToCSV);
    
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
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateConnectionStatus();
        showToast('オフラインモードに切り替わりました（アプリは正常動作）', 'info');
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

// フォーム送信処理（エラー耐性強化版）
async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (!elements.form) {
        showToast('フォームが見つかりません', 'error');
        return;
    }
    
    showLoading('データを保存中...');
    
    try {
        // フォームデータの取得と検証
        const formData = new FormData(elements.form);
        const rawData = {
            location: formData.get('location'),
            coordinates: formData.get('coordinates'),
            dateTime: formData.get('dateTime'),
            temperature: formData.get('temperature'),
            ph: formData.get('ph'),
            dissolvedOxygen: formData.get('dissolvedOxygen'),
            turbidity: formData.get('turbidity'),
            conductivity: formData.get('conductivity'),
            depth: formData.get('depth'),
            weather: formData.get('weather'),
            notes: formData.get('notes')
        };
        
        // データ検証とクリーニング
        const data = validateAndCleanData(rawData);
        
        // 座標の検証
        if (data.coordinates && !gpsManager.validateCoordinates(data.coordinates)) {
            showToast('座標の形式が正しくありません。形式: 緯度, 経度', 'warning');
            const coordinatesInput = document.getElementById('coordinates');
            if (coordinatesInput) {
                coordinatesInput.focus();
                coordinatesInput.style.borderColor = '#f44336';
            }
            return;
        }
        
        // 必須フィールドのチェック
        if (!data.location || data.location.trim() === '') {
            showToast('調査地点名を入力してください', 'warning');
            const locationInput = document.getElementById('location');
            if (locationInput) {
                locationInput.focus();
            }
            return;
        }
        
        // ローカルに保存（複数回試行）
        let saveSuccess = false;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!saveSuccess && attempts < maxAttempts) {
            attempts++;
            try {
                await saveToLocal(data);
                saveSuccess = true;
                console.log(`データ保存成功 (試行${attempts}回目):`, data.id);
            } catch (saveError) {
                console.warn(`データ保存失敗 (試行${attempts}回目):`, saveError);
                if (attempts === maxAttempts) {
                    throw saveError;
                }
                // 短時間待機してリトライ
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        showToast('データを保存しました', 'success');
        clearForm();
        
        // データ一覧の更新
        try {
            await loadLocalData();
            if (document.getElementById('data-list')?.classList.contains('active')) {
                displayData();
            }
        } catch (updateError) {
            console.warn('データ一覧更新エラー:', updateError);
            // 表示更新の失敗は致命的ではないので続行
        }
        
    } catch (error) {
        console.error('フォーム送信エラー:', error);
        let errorMessage = 'データ保存中にエラーが発生しました';
        
        if (error.message.includes('ID')) {
            errorMessage = 'データIDの生成に失敗しました。再度お試しください';
        } else if (error.message.includes('storage')) {
            errorMessage = 'ストレージへの保存に失敗しました。ブラウザの設定をご確認ください';
        }
        
        showToast(errorMessage, 'error');
    } finally {
        hideLoading();
    }
}

// データ検証とクリーニング関数
function validateAndCleanData(rawData) {
    const data = {
        id: generateId(),
        location: (rawData.location || '').trim(),
        coordinates: (rawData.coordinates || '').trim(),
        dateTime: rawData.dateTime || new Date().toISOString().slice(0, 16),
        temperature: parseNumberSafely(rawData.temperature),
        ph: parseNumberSafely(rawData.ph),
        dissolvedOxygen: parseNumberSafely(rawData.dissolvedOxygen),
        turbidity: parseNumberSafely(rawData.turbidity),
        conductivity: parseNumberSafely(rawData.conductivity, true), // 整数
        depth: parseNumberSafely(rawData.depth),
        weather: (rawData.weather || '').trim(),
        notes: (rawData.notes || '').trim(),
        timestamp: new Date(),
        synced: false // ローカル専用のため常にfalse
    };
    
    return data;
}

// 安全な数値変換関数
function parseNumberSafely(value, isInteger = false) {
    if (!value || value === '') return null;
    
    const num = isInteger ? parseInt(value) : parseFloat(value);
    return isNaN(num) ? null : num;
}

// ローカルデータ保存（エラー耐性強化版）
async function saveToLocal(data) {
    try {
        // データの最終検証
        if (!data || !data.id) {
            throw new Error('保存データが無効です: ID が必要です');
        }
        
        // タイムスタンプの確保
        if (!data.timestamp) {
            data.timestamp = new Date();
        }
        
        // 深いコピーを作成してデータの整合性を保つ
        const dataToSave = JSON.parse(JSON.stringify(data));
        
        // 保存実行
        const result = await localDataManager.save(dataToSave);
        console.log('ローカルデータ保存完了:', result.id);
        
        return result;
        
    } catch (error) {
        console.error('ローカルデータ保存エラー:', error);
        
        // エラーの詳細に応じて適切な例外を投げる
        if (error.message.includes('quota') || error.message.includes('storage')) {
            throw new Error('ストレージ容量が不足しています。古いデータを削除してください');
        } else if (error.message.includes('transaction')) {
            throw new Error('データベーストランザクションエラーが発生しました');
        } else {
            throw new Error(`データ保存エラー: ${error.message}`);
        }
    }
}

// ローカルデータ読み込み
async function loadLocalData() {
    try {
        localData = await localDataManager.getAll();
        console.log('ローカルデータ読み込み完了:', localData.length + '件');
        
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

// ローカルデータ削除
async function clearLocalData() {
    if (!confirm('ローカルに保存されたすべてのデータを削除しますか？\n※ この操作は取り消せません')) {
        return;
    }
    
    showLoading('ローカルデータを削除中...');
    
    try {
        await localDataManager.clear();
        localData = [];
        displayData();
        
        showToast('ローカルデータを削除しました', 'success');
        
    } catch (error) {
        console.error('ローカルデータ削除エラー:', error);
        showToast('ローカルデータ削除中にエラーが発生しました', 'error');
    } finally {
        hideLoading();
    }
}

// GPS位置情報取得（エラー耐性強化版）
async function getCurrentLocation() {
    const button = document.getElementById('get-location');
    const coordinatesInput = document.getElementById('coordinates');
    
    if (!button || !coordinatesInput) {
        showToast('GPS機能の初期化に失敗しました', 'error');
        return;
    }
    
    // ボタンの状態変更
    const originalText = button.innerHTML;
    button.innerHTML = '<div class="loading-spinner" style="width: 16px; height: 16px;"></div>';
    button.disabled = true;
    
    try {
        showLoading('位置情報を取得中...');
        
        // GPS取得を試行（必ずフォールバックあり）
        try {
            const position = await gpsManager.getCurrentPosition();
            
            const lat = position.coords.latitude.toFixed(6);
            const lng = position.coords.longitude.toFixed(6);
            coordinatesInput.value = `${lat}, ${lng}`;
            coordinatesInput.style.borderColor = '#4CAF50';
            
            const accuracy = Math.round(position.coords.accuracy);
            showToast(`GPS位置情報を取得しました（精度: ${accuracy}m）`, 'success');
            
        } catch (gpsError) {
            // GPS取得失敗時は必ずフォールバック実行
            console.log('GPS取得失敗、フォールバックを実行:', gpsError.message);
            
            // 既に座標が入力されている場合はそのまま使用
            if (coordinatesInput.value.trim()) {
                const isValid = gpsManager.validateCoordinates(coordinatesInput.value);
                if (isValid) {
                    showToast('既存の座標を使用します', 'info');
                } else {
                    // 無効な座標の場合はクリアして手動入力を促す
                    coordinatesInput.value = '';
                    gpsManager.handleLocationFallback();
                }
            } else {
                // 座標が未入力の場合はフォールバック
                gpsManager.handleLocationFallback();
            }
        }
        
    } catch (error) {
        // 予期しないエラーの場合
        console.error('予期しないエラー:', error);
        showToast('位置情報取得でエラーが発生しました。手動入力をご利用ください', 'warning');
        
        // 確実にフォールバックを実行
        coordinatesInput.readOnly = false;
        coordinatesInput.focus();
        coordinatesInput.placeholder = '手動で座標を入力してください';
        
    } finally {
        // ボタンを必ず復元
        button.innerHTML = originalText;
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

// 座標ヘルプ用グローバル関数
window.showHelpTab = function(tabName) {
    // すべてのヘルプタブを非アクティブに
    document.querySelectorAll('.help-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.help-tab-content').forEach(content => content.classList.remove('active'));
    
    // 選択されたタブをアクティブに
    const targetTab = document.querySelector(`[onclick="showHelpTab('${tabName}')"]`);
    if (targetTab) targetTab.classList.add('active');
    
    const targetContent = document.getElementById(`help-${tabName}`);
    if (targetContent) targetContent.classList.add('active');
};

window.setCoordinates = function(coords) {
    const coordinatesInput = document.getElementById('coordinates');
    if (coordinatesInput) {
        coordinatesInput.value = coords;
        coordinatesInput.style.borderColor = '#4CAF50';
        gpsManager.validateCoordinates(coords);
        showToast('座標を設定しました: ' + coords, 'success');
    }
    closeCoordinateHelp();
};

window.closeCoordinateHelp = function() {
    const popup = document.getElementById('coordinate-help-popup');
    if (popup && popup.parentNode) {
        popup.parentNode.removeChild(popup);
    }
}; 