document.querySelector('#open-popup').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }));
