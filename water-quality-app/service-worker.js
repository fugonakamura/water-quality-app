// Service Worker for 水質調査データメモアプリ (スマホ対応版)
// オフライン機能とキャッシュ管理

const CACHE_NAME = 'water-quality-app-v1.1.0';
const STATIC_CACHE_NAME = 'water-quality-static-v1.1.0';

// キャッシュするリソース
const STATIC_RESOURCES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './firebase-config.js',
    './manifest.json'
];

// Firebase CDN リソース
const FIREBASE_RESOURCES = [
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js'
];

// Service Worker インストール
self.addEventListener('install', event => {
    console.log('Service Worker: インストール中...');
    
    event.waitUntil(
        Promise.all([
            // 静的リソースのキャッシュ
            caches.open(STATIC_CACHE_NAME).then(cache => {
                console.log('Service Worker: 静的リソースをキャッシュ中...');
                return cache.addAll(STATIC_RESOURCES);
            }),
            // Firebase CDN リソースのキャッシュ
            caches.open(CACHE_NAME).then(cache => {
                console.log('Service Worker: Firebase CDNリソースをキャッシュ中...');
                return Promise.allSettled(
                    FIREBASE_RESOURCES.map(url => 
                        cache.add(url).catch(err => 
                            console.warn(`キャッシュ失敗: ${url}`, err)
                        )
                    )
                );
            })
        ]).then(() => {
            console.log('Service Worker: インストール完了');
            return self.skipWaiting();
        }).catch(error => {
            console.error('Service Worker: インストール失敗', error);
        })
    );
});

// Service Worker アクティベート
self.addEventListener('activate', event => {
    console.log('Service Worker: アクティベート中...');
    
    event.waitUntil(
        Promise.all([
            // 古いキャッシュの削除
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE_NAME) {
                            console.log('Service Worker: 古いキャッシュを削除:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            self.clients.claim()
        ]).then(() => {
            console.log('Service Worker: アクティベート完了');
        })
    );
});

// フェッチイベント（ネットワークリクエストの処理）
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Firebase関連のリクエストの処理
    if (url.hostname.includes('firestore.googleapis.com') || 
        url.hostname.includes('firebase.google.com')) {
        event.respondWith(handleFirebaseRequest(request));
        return;
    }
    
    // 静的リソースの処理
    if (request.method === 'GET') {
        event.respondWith(handleStaticRequest(request));
    }
});

// Firebase リクエストの処理
async function handleFirebaseRequest(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Firebase: ネットワークエラー、キャッシュから取得を試行', error);
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response(
            JSON.stringify({ 
                error: 'offline', 
                message: 'オフラインのため、このリクエストは処理できません' 
            }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// 静的リソースの処理（Cache First戦略）
async function handleStaticRequest(request) {
    try {
        // まずキャッシュから探す
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            // バックグラウンドでキャッシュを更新
            updateCache(request);
            return cachedResponse;
        }
        
        // キャッシュになければネットワークから取得
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('静的リソース: ネットワークエラー', error);
        
        if (request.url.includes('.html') || request.url.endsWith('/')) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            const fallbackResponse = await cache.match('./index.html');
            if (fallbackResponse) {
                return fallbackResponse;
            }
        }
        
        return new Response(
            'オフラインのため、このリソースは利用できません',
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
            }
        );
    }
}

// バックグラウンドでキャッシュを更新
async function updateCache(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
    } catch (error) {
        console.log('バックグラウンドキャッシュ更新失敗:', error.message);
    }
}

// メッセージ処理
self.addEventListener('message', event => {
    const { action, data } = event.data;
    
    switch (action) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CLEAR_CACHE':
            clearCache().then(() => {
                event.ports[0].postMessage({ success: true });
            }).catch(error => {
                event.ports[0].postMessage({ success: false, error: error.message });
            });
            break;
            
        case 'GET_CACHE_STATUS':
            getCacheStatus().then(status => {
                event.ports[0].postMessage(status);
            });
            break;
    }
});

// キャッシュクリア
async function clearCache() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
    );
    console.log('Service Worker: すべてのキャッシュを削除しました');
}

// キャッシュ状況の取得
async function getCacheStatus() {
    try {
        const cacheNames = await caches.keys();
        const status = {};
        
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            status[cacheName] = keys.length;
        }
        
        return {
            success: true,
            caches: status,
            totalCaches: cacheNames.length
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

console.log('Service Worker: 初期化完了'); 