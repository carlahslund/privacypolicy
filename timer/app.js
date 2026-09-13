(() => {
  'use strict';
  /* The coach-facing UI. Ported from the Windows build of the Gracie Barra Timer:
     the display and control markup, the render loop and the buzzer voices are
     unchanged. What is new is the shell object — it decides where session state
     comes from (a server over /api/*, or a timer engine running inside this page)
     and whether the buzzer is played here or natively by the TV app. */
  const shell = window.GB_SHELL || {};
  if (!shell.transport) shell.transport = window.GBTransport.http('');
  /* Read through the shell rather than capturing it: the Samsung app can be pointed
     at a timer running elsewhere on the gym Wi-Fi while the page stays up. */
  const transport = {
    get current() { return shell.transport; },
    state: () => shell.transport.state(),
    action: (name) => shell.transport.action(name),
    config: (value) => shell.transport.config(value),
    pair: (pin) => shell.transport.pair(pin)
  };
  const isTv = shell.tv === true;
  const isDisplay = isTv || location.pathname !== '/control';
  const display = document.getElementById('display');
  const control = document.getElementById('control');
  display.hidden = !isDisplay;
  control.hidden = isDisplay;
  const $ = (id) => document.getElementById(id);
  const presets = {positional:[180,30],regular:[300,60],competition:[360,60],eight:[480,60],ten:[600,60],shark:[120,15],open:[0,0]};
  const names = {positional:'POSITIONAL SPARRING',regular:'REGULAR ROUNDS',competition:'COMPETITION ROUNDS',eight:'8-MINUTE ROUNDS',ten:'10-MINUTE ROUNDS',shark:'SHARK TANK',open:'OPEN MAT',custom:'CUSTOM ROUNDS'};
  const options = ['Closed Guard','Open Guard','Half Guard','Side Control','Mount','Back Control','Takedowns','Passing','Escapes'];
  let selectedPreset = 'positional';
  let state = null;
  let snapshotAt = 0;
  let lastEvent = null;
  let audio = null;
  let wakeLock = null;
  let busy = false;
  let qrAddress = null;
  let manualAddress = null;
  const listeners = [];

  function mmss(n) { n = Math.max(0, Math.floor(n)); return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
  function readTime(raw) {
    const s = String(raw).trim();
    if (!/^\d{1,2}(:[0-5]\d)?$/.test(s)) throw new Error('Use M:SS for round and rest times, such as 3:00 or 0:30.');
    const [m, sec='0'] = s.split(':').map(Number);
    return m*60+Number(sec);
  }
  function showError(message) {
    if (isTv) { window.GBTvMenu?.notify(message); return; }
    if (!isDisplay) { $('error').textContent = message; $('error').hidden = false; }
  }
  function clearError() { if (!isDisplay) $('error').hidden = true; }

  async function action(name) {
    if (busy) return;
    busy = true;
    try { await transport.action(name); clearError(); await poll(); }
    catch (err) { showError(err.message); if (isDisplay && !isTv && err.message.includes('Pair')) location.href='/control'; }
    finally { busy = false; }
  }
  function applyPreset(name) {
    selectedPreset = name;
    for (const button of document.querySelectorAll('[data-preset]')) button.classList.toggle('selected', button.dataset.preset === name);
    if (presets[name]) {
      $('round-input').value = mmss(presets[name][0]);
      $('rest-input').value = mmss(presets[name][1]);
    }
    const open = name === 'open';
    $('round-input').disabled = open;
    $('rest-input').disabled = open;
    $('rounds-input').disabled = open;
    $('position-select').disabled = open;
    $('alternate-input').disabled = open;
    $('warning-input').disabled = open;
    if (name === 'positional' && !$('position-select').value) $('position-select').value = 'Half Guard';
  }
  function fillSettings(config) {
    applyPreset(config.preset);
    $('round-input').value = mmss(config.round);
    $('rest-input').value = mmss(config.rest);
    $('rounds-input').value = config.rounds;
    $('alternate-input').checked = config.alternate;
    $('warning-input').checked = config.warning;
    $('buzzer-select').value = config.buzzer || 'classic';
    $('volume-input').value = Math.round((config.buzzer_volume || .8)*100);
    $('volume-number').textContent = `${$('volume-input').value}%`;
    if (!config.position) $('position-select').value = '';
    else if (options.includes(config.position)) $('position-select').value = config.position;
    else { $('position-select').value = 'custom'; $('custom-position').value = config.position; }
    $('custom-position-wrap').hidden = $('position-select').value !== 'custom';
  }
  function configFromForm() {
    return {preset:selectedPreset,round:readTime($('round-input').value),rest:readTime($('rest-input').value),rounds:Number($('rounds-input').value),position:$('position-select').value === 'custom' ? $('custom-position').value : $('position-select').value,alternate:$('alternate-input').checked,warning:$('warning-input').checked,buzzer:$('buzzer-select').value,buzzer_volume:Number($('volume-input').value)/100};
  }

  /* On a TV the app owns the speakers, so the buzzer starts without anybody having
     to press anything. In a browser tab it still needs the one-time gesture. */
  function startAudio() {
    if (shell.nativeAudio) return Promise.resolve(false);
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { return Promise.resolve(false); }
    /* resume() keeps its promise even when the browser leaves the context
       suspended for want of a gesture, so the state is the only honest answer —
       believing the promise hides the one button that can turn the buzzer on. */
    return audio.resume().then(() => audio.state === 'running').catch(() => false);
  }
  function unlockSound() {
    startAudio().then(ok => {
      const button = $('sound-button');
      if (!button) return;
      if (ok) { button.textContent='🔊 SOUND ON'; button.style.opacity='.5'; }
      else button.textContent='SOUND UNAVAILABLE';
    });
    if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(lock => wakeLock=lock).catch(() => {});
  }
  function tone(frequency, start, length, loud=.25, type='sawtooth') {
    if (!audio || audio.state !== 'running') return;
    const osc=audio.createOscillator(), gain=audio.createGain();
    osc.type=type; osc.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(.001,start); gain.gain.exponentialRampToValueAtTime(loud,start+.02);
    gain.gain.setValueAtTime(loud,start+Math.max(.03,length-.08)); gain.gain.exponentialRampToValueAtTime(.001,start+length);
    osc.connect(gain); gain.connect(audio.destination); osc.start(start); osc.stop(start+length+.03);
  }
  function bell(frequency, start, length, loud) {
    if (!audio || audio.state !== 'running') return;
    const osc=audio.createOscillator(), gain=audio.createGain();
    osc.type='sine'; osc.frequency.value=frequency;
    gain.gain.setValueAtTime(.001,start);
    gain.gain.exponentialRampToValueAtTime(loud,start+.015);
    gain.gain.exponentialRampToValueAtTime(.001,start+length);
    osc.connect(gain);gain.connect(audio.destination);osc.start(start);osc.stop(start+length+.03);
  }
  function sound(kind, style=state?.config.buzzer || 'classic', volume=state?.config.buzzer_volume || .8) {
    if (shell.nativeAudio) return;
    if (!audio || audio.state !== 'running') return;
    const t=audio.currentTime+.01;
    if (kind==='warning') tone(900,t,.19,.16,'sine');
    else if (kind==='end_round' || kind==='manual') {
      if (style==='airhorn') {
        for (const start of [t,t+.95]) { tone(140,start,.82,.25*volume);tone(146,start,.82,.17*volume);tone(195,start,.82,.12*volume); }
      } else if (style==='bell') {
        for (const start of [t,t+.73,t+1.46]) { bell(620,start,1.25,.21*volume);bell(930,start,1.2,.13*volume);bell(1240,start,.95,.09*volume); }
      } else if (style==='digital') {
        [660,880,1100,880].forEach((freq,i)=>tone(freq,t+i*.28,.23,.27*volume,'sine'));
      } else {
        tone(185,t,.7,.35*volume); tone(192,t,.7,.22*volume);
        tone(185,t+.82,.65,.35*volume); tone(192,t+.82,.65,.22*volume);
      }
    } else if (kind==='end_rest') { tone(370,t,.42,.25); tone(470,t+.5,.42,.25); }
  }
  function remaining() {
    if (!state) return 0;
    const elapsed = (performance.now()-snapshotAt)/1000;
    return state.running ? state.config.preset === 'open' ? state.seconds+elapsed : Math.max(0,state.seconds-elapsed) : state.seconds;
  }
  function render() {
    if (!state) return;
    const cfg=state.config, phase=state.phase, sec=remaining();
    const shown=cfg.preset==='open' ? Math.floor(sec) : Math.ceil(sec);
    const time=mmss(shown);
    const mode=names[cfg.preset] || names.custom;
    const isRest=phase==='rest', complete=phase==='complete', idle=phase==='idle';
    const warning=phase==='round' && state.running && cfg.warning && sec>0 && sec<=10;
    const position=cfg.position || 'FREE ROLL';
    const status=complete?'SESSION COMPLETE':idle?'READY':!state.running?'PAUSED':isRest?'REST':cfg.preset==='open'?'OPEN MAT':warning?'FINISH STRONG':'ROLL';
    if (isDisplay) {
      display.classList.toggle('rest',isRest); display.classList.toggle('warning',warning); display.classList.toggle('complete',complete);
      $('round-pill').textContent=cfg.preset==='open'?'STOPWATCH':complete?'FINISHED':`ROUND ${state.round_number} / ${cfg.rounds}`;
      $('display-mode').textContent=isRest?'RECOVER · RESET · GO AGAIN':mode;
      $('display-position').textContent=complete?'WELL DONE':isRest?'REST':position;
      $('display-time').textContent=time;
      $('display-status').textContent=status;
      $('display-roles').textContent=cfg.alternate && cfg.preset!=='open' && !complete ? (state.round_number%2 ? 'A TOP · B BOTTOM' : 'B TOP · A BOTTOM') : '';
      $('display-next').textContent=complete?'SESSION COMPLETE':isRest?`NEXT: ROUND ${state.round_number+1} / ${cfg.rounds}`:cfg.preset==='open'?'COUNTING UP':`NEXT: ${cfg.rest ? mmss(cfg.rest)+' REST' : state.round_number<cfg.rounds ? 'NEXT ROUND' : 'SESSION COMPLETE'}`;
    } else {
      $('live-mode').textContent=mode;
      $('live-round').textContent=cfg.preset==='open'?'OPEN MAT':`ROUND ${state.round_number} / ${cfg.rounds}`;
      $('live-time').textContent=time;
      $('live-status').textContent=status;
      $('live-position').textContent=isRest?'NEXT ROUND':position;
      $('toggle-button').textContent=state.running?'Ⅱ PAUSE':complete?'▶ RESTART':'▶ START';
    }
  }
  function renderQr(next) {
    const urls=next.local_urls || [];
    const choices=manualAddress && !urls.includes(manualAddress) ? [manualAddress,...urls] : urls;
    $('qr-card').hidden=!next.paired;
    $('pair-qr').hidden=!choices.length;
    $('qr-instructions').textContent=choices.length ? 'Point your phone camera here to open the controller and pair automatically. Use the same Wi-Fi as the laptop.' : 'No laptop network address found. Enter the laptop’s Wi-Fi IPv4 address below.';
    $('qr-address').textContent=choices.length ? qrAddress || choices[0] : '';
    if (!choices.length) return;
    const select=$('qr-network');
    const oldUrls=[...select.options].map(option=>option.value).join('|');
    if (oldUrls!==choices.join('|')) {
      select.replaceChildren(...choices.map(url=>new Option(url,url)));
      if (!choices.includes(qrAddress)) qrAddress=choices[0];
      select.value=qrAddress;
    }
    $('qr-network-wrap').hidden=choices.length<2;
    $('qr-address').href=qrAddress;
    if (next.paired && next.pair_pin && $('pair-qr').dataset.address!==qrAddress) {
      $('pair-qr').src=window.GBQr.svg(`${qrAddress}?pair=${next.pair_pin}`);
      $('pair-qr').dataset.address=qrAddress;
      $('qr-address').textContent=qrAddress;
    }
  }
  async function poll() {
    try {
      const next = await transport.state();
      snapshotAt=performance.now();
      if (lastEvent===null) lastEvent=next.events.length ? next.events[next.events.length-1].id : 0;
      else for (const event of next.events) if (event.id>lastEvent && isDisplay && Date.now()/1000-event.epoch<3) sound(event.kind);
      if (next.events.length) lastEvent=Math.max(lastEvent,next.events[next.events.length-1].id);
      if (!state && !isDisplay) fillSettings(next.config);
      state=next;
      document.body.classList.remove('offline');
      if (!isDisplay) {
        $('pair-card').hidden=next.paired;
        $('controls').hidden=!next.paired;
        $('settings').hidden=!next.paired;
        $('phone-url').textContent=next.local_url ? `PHONE ADDRESS: ${next.local_url}` : '';
        renderQr(next);
        $('connection').textContent=next.paired?'● CONNECTED · SAME WI-FI':'● PAIR TO CONTROL';
      }
      render();
      for (const listener of listeners) listener(next);
    } catch (err) {
      document.body.classList.add('offline');
      if (!isDisplay) $('connection').textContent='● OFFLINE · CHECK LAPTOP SERVER';
      for (const listener of listeners) listener(null);
    }
  }

  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>action(button.dataset.action)));
  if (isDisplay) {
    const menu=$('display-menu');
    const openMenu=()=>{ menu.hidden=false; $('menu-button').setAttribute('aria-expanded','true'); menu.querySelector('button[data-action]').focus(); };
    const closeMenu=()=>{ menu.hidden=true; $('menu-button').setAttribute('aria-expanded','false'); $('menu-button').focus(); };
    if (isTv) {
      /* Android sees the remote before the page does, so the hover bar would be
         clutter there. A TV browser may hand the page only a pointer, so it needs
         something to aim at — the bar opens the same ten-foot menu the D-pad does. */
      const bar = $('display-actions');
      bar.hidden = !shell.pointer;
      if (shell.pointer) {
        $('menu-button').addEventListener('click', () => window.GBTvMenu.toggle());
        $('sound-button').hidden = !!shell.nativeAudio;
        $('sound-button').addEventListener('click', unlockSound);
      }
    } else {
      $('sound-button').addEventListener('click',unlockSound);
      $('menu-button').addEventListener('click',()=>menu.hidden?openMenu():closeMenu());
      $('close-menu').addEventListener('click',closeMenu);
      document.addEventListener('keydown',event=>{
        if (event.key==='Escape' || event.key==='Backspace') { if (!menu.hidden) { event.preventDefault();closeMenu(); } return; }
        if (event.key==='Enter' && menu.hidden && document.activeElement.tagName!=='BUTTON') { event.preventDefault();openMenu();return; }
        if (!menu.hidden && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)) {
          const items=[...menu.querySelectorAll('button,a')]; const idx=items.indexOf(document.activeElement);
          const step=event.key==='ArrowDown'?2:event.key==='ArrowUp'?-2:event.key==='ArrowRight'?1:-1;
          items[Math.max(0,Math.min(items.length-1,idx+step))].focus();event.preventDefault();return;
        }
        if (event.key.toLowerCase()==='f') document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();
      });
      document.addEventListener('visibilitychange',()=>{if (!document.hidden && audio && !wakeLock && navigator.wakeLock) navigator.wakeLock.request('screen').then(lock=>wakeLock=lock).catch(()=>{});});
    }
  } else {
    document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
    $('position-select').addEventListener('change',()=>{ $('custom-position-wrap').hidden=$('position-select').value!=='custom'; });
    $('qr-network').addEventListener('change',event=>{ qrAddress=event.target.value; $('pair-qr').dataset.address=''; poll(); });
    $('manual-ip-form').addEventListener('submit',event=>{
      event.preventDefault();
      const ip=$('manual-ip').value.trim();
      const parts=ip.split('.');
      if (parts.length!==4 || parts.some(part=>!/^\d{1,3}$/.test(part) || Number(part)>255) ||
          !((parts[0]==='10') || (parts[0]==='172' && Number(parts[1])>=16 && Number(parts[1])<=31) || (parts[0]==='192' && parts[1]==='168'))) {
        showError('Enter the laptop’s private Wi-Fi IPv4 address, such as 192.168.1.42.');return;
      }
      manualAddress=`http://${parts.map(Number).join('.')}:${location.port || 80}/control`;
      qrAddress=manualAddress;
      $('pair-qr').dataset.address='';
      clearError();poll();
    });
    $('volume-input').addEventListener('input',()=>{ $('volume-number').textContent=`${$('volume-input').value}%`; });
    $('preview-button').addEventListener('click',async()=>{
      if (!await startAudio()) { showError('This browser cannot play the buzzer preview.'); return; }
      sound('manual',$('buzzer-select').value,Number($('volume-input').value)/100);
    });
    $('pair-form').addEventListener('submit',async event=>{
      event.preventDefault();
      try { await transport.pair($('pin').value);$('pin').value='';clearError();await poll(); }
      catch(err){showError(err.message);}
    });
    $('settings-form').addEventListener('submit',async event=>{
      event.preventDefault();
      try { await transport.config(configFromForm());await transport.action('toggle');clearError();await poll(); }
      catch(err){showError(err.message);}
    });
    document.addEventListener('keydown',event=>{
      if (['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)) return;
      const map={' ':'toggle',r:'reset',n:'next',p:'previous',b:'buzzer','+':'plus','-':'minus'};
      const key=event.key.toLowerCase();
      if (map[key]) { event.preventDefault();action(map[key]); }
    });
  }

  /* Handed to the TV shells so the ten-foot menu drives the same code path the
     phone controller does, instead of growing a second copy of the rules. */
  window.GBApp = {
    action, poll, render, mmss, readTime, sound, startAudio, presets, names, options, transport, shell,
    state: () => state,
    remaining,
    /* After a source change nothing on screen is true any more — drop the snapshot
       and the buzzer watermark so the next poll starts the session clean. */
    resync: () => { state = null; lastEvent = null; return poll(); },
    applyConfig: async (config) => { await transport.config(config); await poll(); },
    pair: async (pin) => { await transport.pair(pin); await poll(); },
    onState: (listener) => { listeners.push(listener); }
  };

  if (isTv) startAudio().then(started => {
    /* An app context starts the buzzer on its own; a browser waits for a gesture,
       so there the button has to stay put until someone presses it. */
    if (started && $('sound-button')) $('sound-button').hidden = true;
  });
  const scanCode = !isDisplay ? new URLSearchParams(location.search).get('pair') : null;
  if (scanCode) {
    history.replaceState(null,'',location.pathname);
    if (/^\d{6}$/.test(scanCode)) transport.pair(scanCode).then(()=>{clearError();poll();}).catch(err=>{showError(err.message);poll();});
    else {showError('Invalid QR code. Use the access code from the laptop.');poll();}
  } else poll();
  setInterval(poll,350);
  setInterval(render,75);
})();
