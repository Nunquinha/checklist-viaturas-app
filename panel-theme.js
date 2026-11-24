(()=>{
  const key='checklist-panel-theme',allowed=['blue','green','graphite','light'];
  function apply(value){document.documentElement.dataset.theme=allowed.includes(value)?value:'blue'}
  try{apply(localStorage.getItem(key))}catch{apply('blue')}
  document.addEventListener('DOMContentLoaded',()=>{
    const select=document.getElementById('panel-theme');select.value=document.documentElement.dataset.theme;
    select.addEventListener('change',()=>{apply(select.value);try{localStorage.setItem(key,select.value)}catch{}});
  });
})();
