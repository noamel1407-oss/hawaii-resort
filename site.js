(function(){
  'use strict';
  var d = document, docEl = d.documentElement, body = d.body;
  var nav = d.getElementById('nav');
  var WA = '972544500539', MAIL = 'netora.studio@gmail.com', BRAND = 'NOHOKAI Resort & Spa';
  var mq = function(q){ return window.matchMedia ? window.matchMedia(q).matches : false; };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var tall = mq('(max-aspect-ratio: 4/5)');
  var params = new URLSearchParams(location.search);

  var yr = d.getElementById('yr');
  if(yr) yr.textContent = new Date().getFullYear();

  /* ---------- page veil: fade in on arrival, fade out before leaving ---------- */
  function reveal(){
    body.classList.remove('leaving');
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ body.classList.add('ready'); }); });
  }
  window.addEventListener('pageshow', reveal);
  reveal();
  function go(url){
    body.classList.add('leaving');
    setTimeout(function(){ location.href = url; }, 380);
  }
  d.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if(!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    var href = a.getAttribute('href');
    if(!/^[a-z0-9_-]+\.html$/i.test(href)) return;
    e.preventDefault();
    stopAuto();
    go(href);
  });

  /* ---------- mobile nav ---------- */
  var burger = d.getElementById('burger'), navlinks = d.getElementById('navlinks');
  if(burger){
    burger.addEventListener('click', function(){
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navlinks.addEventListener('click', function(e){
      if(e.target.tagName === 'A'){ nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* ---------- the scroll-driven film ---------- */
  var F = null, kicked = false, autoMult = 1, auto = null;

  function makeFilm(scene){
    var v = scene.querySelector('video'),
        poster = scene.querySelector('.poster'),
        load = scene.querySelector('.loading'),
        caps = [].slice.call(scene.querySelectorAll('.cap')),
        ui = scene.querySelector('.tour-ui'),
        hint = scene.querySelector('.hint'),
        fin = scene.querySelector('.fin, .lead'),
        bar = scene.querySelector('.hud .bar i');
    var share = parseFloat(scene.getAttribute('data-share')) || 1,
        dur = parseFloat(scene.getAttribute('data-dur')) || 0;
    var ins = caps.map(function(c){ return parseFloat(c.getAttribute('data-in')); }),
        outs = caps.map(function(c){ return parseFloat(c.getAttribute('data-out')); });
    var cur = 0, ready = false, dead = false, lastCap = -2, lastFin = null, lastHint = null, lastBar = -1;

    v.src = tall ? v.getAttribute('data-tall') : v.getAttribute('data-wide');

    function hideOverlay(){
      load.style.opacity = 0;
      if(ui) ui.classList.remove('wait');
      setTimeout(function(){ load.style.display = 'none'; }, 600);
    }
    function grabMeta(){
      if(isFinite(v.duration) && v.duration > 0) dur = v.duration;
    }
    function onReady(){
      if(ready) return;
      ready = true; grabMeta();
      hideOverlay();
      /* the poster is the film's own first frame, so it only steps aside once a real frame is on screen */
      if(v.requestVideoFrameCallback){
        v.requestVideoFrameCallback(function(){ poster.style.opacity = 0; });
        setTimeout(function(){ poster.style.opacity = 0; }, 900);
      } else {
        poster.style.opacity = 0;
      }
    }
    function onDead(){ dead = true; hideOverlay(); }
    v.addEventListener('loadedmetadata', grabMeta);
    v.addEventListener('durationchange', grabMeta);
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('error', onDead);
    grabMeta();
    if(v.readyState >= 2) onReady();
    if(v.error) onDead();

    var api = {
      scene: scene, v: v, share: share, playing: false,
      dur: function(){ return dur; },
      ready: function(){ return ready; },
      dead: function(){ return dead; },
      sync: function(){ cur = v.currentTime || 0; },
      measure: function(vh){
        var r = scene.getBoundingClientRect();
        var total = Math.max(1, scene.offsetHeight - vh);
        return {
          p: Math.max(0, Math.min(1, (-r.top) / total)),
          near: r.bottom > -vh && r.top < vh * 2,
          past: r.bottom < vh * 0.5
        };
      },
      apply: function(m, dt){
        if(!dead && ready && dur > 0 && m.near){
          if(api.playing){
            cur = v.currentTime;
          } else {
            var t = Math.min(1, m.p / share) * Math.max(0, dur - 0.05);
            var k = 1 - Math.pow(1 - 0.18, dt * 60);       /* same feel at 60Hz and 120Hz */
            cur += (t - cur) * k;
            if(Math.abs(t - cur) < 0.003) cur = t;
            if(!v.seeking && Math.abs(v.currentTime - cur) > 0.012){
              try{ v.currentTime = cur; }catch(e){}
            }
          }
        }
        var ft = api.playing ? v.currentTime : Math.min(1, m.p / share) * dur;
        var end = m.p > share * 0.985;
        var on = -1;
        if(!end){
          for(var i = 0; i < caps.length; i++){ if(ft >= ins[i] && ft < outs[i]){ on = i; break; } }
        }
        if(on !== lastCap){
          lastCap = on;
          for(var j = 0; j < caps.length; j++) caps[j].classList.toggle('on', j === on);
        }
        if(fin && end !== lastFin){ lastFin = end; fin.classList.toggle('on', end); if(ui) ui.classList.toggle('off', end); }
        if(hint){
          var ho = (m.p < 0.03 && !api.playing) ? '1' : '0';
          if(ho !== lastHint){ lastHint = ho; hint.classList.toggle('gone', ho === '0'); }
        }
        if(bar){
          var b = Math.round(Math.min(1, m.p / share) * 1000) / 1000;
          if(b !== lastBar){ lastBar = b; bar.style.transform = 'scaleX(' + b + ')'; }
        }
      }
    };
    return api;
  }

  var sceneEl = d.querySelector('.scene[data-dur]');
  if(sceneEl) F = makeFilm(sceneEl);

  /* iOS only lets a video be scrubbed after it has been started once */
  function kick(){
    if(kicked || !F || F.playing) return;
    var p = F.v.play();
    if(p && p.then){
      p.then(function(){
        if(!F.playing) F.v.pause();
        kicked = true;
        window.removeEventListener('pointerdown', kick);
        window.removeEventListener('keydown', kick);
      }).catch(function(){});
    }
  }
  if(F){
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    kick();
  }

  /* ---------- the live tour: the film plays by itself and carries the scroll with it ---------- */
  var playBtn = d.getElementById('play');
  function setBtn(on){
    if(!playBtn) return;
    playBtn.classList.toggle('on', on);
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    playBtn.querySelector('.t').textContent = on ? 'עצירה' : 'סיור חי';
  }
  function stopAuto(){
    if(!auto) return;
    cancelAnimationFrame(auto.raf);
    clearTimeout(auto.timer);
    auto = null;
    docEl.style.scrollBehavior = '';
    if(F && F.playing){ F.playing = false; try{ F.v.pause(); }catch(e){} F.sync(); }
    setBtn(false);
  }
  function startAuto(){
    if(auto || !F) return;
    auto = {raf: 0, timer: 0, last: performance.now(), mode: 'play', done: false};
    docEl.style.scrollBehavior = 'auto';
    setBtn(true);
    auto.raf = requestAnimationFrame(autoStep);
  }
  function autoStep(now){
    if(!auto) return;
    var dt = Math.min((now - auto.last) / 1000, 0.1); auto.last = now;
    var vh = window.innerHeight, sc = F.scene, v = F.v, D = F.dur();
    var y = window.scrollY || window.pageYOffset;
    var top = sc.getBoundingClientRect().top + y;
    var total = Math.max(1, sc.offsetHeight - vh);
    var p = Math.max(0, Math.min(1, (y - top) / total));
    var base = D > 0 ? (total * F.share) / D : 0.3 * vh;          /* px per second at natural speed */

    if(!F.ready() && !F.dead()){
      /* wait for the film to load */
    } else if(p < F.share - 0.0006 && !F.dead() && D > 0 && auto.mode === 'play'){
      if(!F.playing){
        try{ v.currentTime = Math.min(D - 0.05, (p / F.share) * D); }catch(e){}
        v.playbackRate = autoMult;
        F.playing = true;
        var pr = v.play();
        if(pr && pr.catch) pr.catch(function(){ if(auto){ F.playing = false; auto.mode = 'seek'; } });
      } else {
        if(v.playbackRate !== autoMult) v.playbackRate = autoMult;
        var tp = Math.min(1, v.currentTime / D) * F.share;
        if(v.ended) tp = F.share;
        window.scrollTo(0, top + tp * total);
      }
    } else {
      if(F.playing){ F.playing = false; try{ v.pause(); }catch(e){} F.sync(); }
      if(p < 0.9995){
        window.scrollBy(0, Math.max(1, base * autoMult * dt));
      } else if(!auto.done){
        auto.done = true;
        var next = sc.getAttribute('data-next');
        if(next){
          auto.timer = setTimeout(function(){ if(auto){ auto = null; setBtn(false); go(next + '?auto=1'); } }, 2000);
        } else {
          stopAuto(); return;
        }
      }
    }
    auto.raf = requestAnimationFrame(autoStep);
  }
  if(playBtn) playBtn.addEventListener('click', function(){ if(auto) stopAuto(); else startAuto(); });
  window.addEventListener('wheel', function(){ stopAuto(); }, {passive: true});
  window.addEventListener('touchstart', function(e){
    if(auto && !(e.target.closest && e.target.closest('#play'))) stopAuto();
  }, {passive: true});
  window.addEventListener('keydown', function(e){
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.key === '1' || e.key === '2' || e.key === '3'){ autoMult = e.key === '1' ? 1 : (e.key === '2' ? 1.5 : 2); return; }
    if(e.key === 'a' || e.key === 'A'){ if(!e.repeat){ if(auto) stopAuto(); else startAuto(); } return; }
    if(auto && /^(Arrow|Page|Home|End|Escape| )/.test(e.key)) stopAuto();
  });
  if(F && params.get('auto') === '1'){
    try{ history.replaceState(null, '', location.pathname); }catch(e){}
    startAuto();
  }

  /* ---------- frame loop ---------- */
  var last = performance.now(), solid = null;
  function loop(now){
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    if(F){
      var m = F.measure(window.innerHeight);
      F.apply(m, dt);
      if(m.past !== solid){ solid = m.past; nav.classList.toggle('solid', solid); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- the contact page shows its form straight away ---------- */
  var still = d.querySelector('.stage.still .lead');
  if(still) setTimeout(function(){ still.classList.add('on'); }, 260);

  /* ---------- lead form -> WhatsApp ---------- */
  var form = d.getElementById('lead');
  if(form){
    var btn = d.getElementById('send');
    var fail = function(msg){
      var old = form.parentNode.querySelector('.err');
      if(old) old.remove();
      var e = d.createElement('div'); e.className = 'err'; e.setAttribute('role', 'alert'); e.textContent = msg;
      form.insertAdjacentElement('afterend', e);
    };
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var name = d.getElementById('fn').value.trim(),
          phone = d.getElementById('ph').value.trim(),
          mail = d.getElementById('em').value.trim(),
          type = d.getElementById('tp').value;
      if(!name || !phone){ fail('נא למלא שם מלא וטלפון.'); return; }
      if(!type){ fail('נא לבחור סוג חופשה.'); return; }
      var text = 'שלום, אשמח לקבל פרטים על חופשה ב-' + BRAND + '.\n'
               + 'שם: ' + name + '\n'
               + 'טלפון: ' + phone + '\n'
               + (mail ? 'אימייל: ' + mail + '\n' : '')
               + 'סוג החופשה: ' + type;
      var wa = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text);
      window.open(wa, '_blank', 'noopener');
      btn.disabled = true;
      form.style.display = 'none';
      var old = form.parentNode.querySelector('.err');
      if(old) old.remove();
      var done = d.createElement('div');
      done.className = 'done';
      var first = name.split(' ')[0];
      done.appendChild(d.createTextNode('תודה' + (first ? ' ' + first : '') + '. נפתח וואטסאפ עם הפרטים, נשאר רק ללחוץ שליחה.'));
      done.appendChild(d.createElement('br'));
      done.appendChild(d.createTextNode('לא נפתח? '));
      var a1 = d.createElement('a'); a1.href = wa; a1.target = '_blank'; a1.rel = 'noopener'; a1.textContent = 'לחצו כאן';
      done.appendChild(a1);
      done.appendChild(d.createTextNode(' או שלחו מייל ל־'));
      var a2 = d.createElement('a'); a2.href = 'mailto:' + MAIL; a2.textContent = MAIL; a2.dir = 'ltr';
      done.appendChild(a2);
      done.appendChild(d.createTextNode('.'));
      form.insertAdjacentElement('afterend', done);
    });
  }
})();
