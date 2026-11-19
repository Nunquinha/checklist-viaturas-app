(() => {
  const button = document.getElementById('install-app');
  const dialog = document.getElementById('install-dialog');
  const standalone = matchMedia('(display-mode: standalone)');
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  let prompt;
  const installed = () => standalone.matches || navigator.standalone===true;
  const update = () => { button.hidden = installed() || location.protocol==='file:'; };
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    prompt = event;
    update();
  });
  window.addEventListener('appinstalled',()=>{ prompt=undefined; button.hidden=true; });
  standalone.addEventListener('change',update);
  button.onclick = async () => {
    const webApp = Boolean(window.google?.script?.run);
    if(webApp) {
      window.open('https://nunquinha.github.io/checklist-viaturas-app/','_blank','noopener');
      return;
    }
    if(prompt) {
      const request = prompt;
      prompt = undefined;
      try {
        await request.prompt();
        if((await request.userChoice).outcome==='accepted')button.hidden=true;
        return;
      } catch { /* Show the browser's manual installation steps. */ }
    }
    document.getElementById('install-instructions').textContent = ios
      ? 'Abra este link no Safari. Toque em Compartilhar, escolha “Adicionar à Tela de Início” e confirme em “Adicionar”.'
      : 'Abra este link no Chrome ou no Edge. No menu do navegador, escolha “Instalar app” ou “Adicionar à tela inicial”.';
    dialog.showModal();
  };
  update();
})();
