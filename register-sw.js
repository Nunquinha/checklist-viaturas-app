if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error => console.warn('Cache offline indisponível',error));
}
