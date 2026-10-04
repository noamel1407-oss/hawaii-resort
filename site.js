(function(){
  'use strict';
  var d = document, docEl = d.documentElement, body = d.body;
  var mq = function(q){ return window.matchMedia ? window.matchMedia(q).matches : false; };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var coarse = mq('(hover: none), (pointer: coarse)');
  var params = new URLSearchParams(location.search);
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var WA = '972544500539', MAIL = 'netora.studio@gmail.com', BRAND = 'NOHOKAI Resort & Spa';
  var clamp = function(v, a, b){ return v < a ? a : (v > b ? b : v); };
  var ease = function(t){ return t * t * (3 - 2 * t); };
  /* The page's own heights are written in vh, which on phones is the LARGE viewport and stays fixed while the browser toolbar
     slides in and out. window.innerHeight does change with the toolbar, so measuring with it made the films drift against the
     scroll. Everything is measured with the same fixed unit instead. */
  var vhProbe = d.createElement('div');
  vhProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none';
  body.appendChild(vhProbe);
  var VH = vhProbe.offsetHeight || window.innerHeight;
  var vhpx = function(){ return VH; };
  var isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(navigator.userAgent);

  var yr = d.getElementById('yr');
  if(yr) yr.textContent = new Date().getFullYear();

  /* =====================================================================
     FILM: every frame of the film is decoded on its own and painted on a
     canvas, so the picture follows the scroll exactly, frame for frame.
     The mp4 is fetched as plain bytes; the .json beside it says where each
     frame sits. Frames are decoded a group (12 frames) at a time, a little
     ahead of the scroll, and only the groups around the current position
     are kept in memory. Browsers without a frame decoder fall back to a
     <video> element that is seeked.
     ===================================================================== */
  function Film(scene){
    this.scene = scene;
    this.stage = scene.querySelector('.stage');
    this.canvas = scene.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', {alpha: false});
    this.poster = scene.querySelector('.poster');
    this.name = scene.getAttribute('data-film');
    this.tall = (window.innerWidth / window.innerHeight) <= 0.62;
    /* phone films. arrival: the window stays on the middle of the wide film from the first frame, so the opening shows the entrance (v2).
       wellness: the window follows the people through the gym and the yoga studio, then stays on the middle through the flight out to the
       sea and the closing view of the resort, so the last picture comes to rest instead of sliding sideways (v4). */
    var TALL = {arrival: '-tall-v2', wellness: '-tall-v4'};
    this.base = 'media/' + this.name + (this.tall ? (TALL[this.name] || '-tall-v2') : '-wide-v2');
    this.meta = null; this.buf = null; this.off = null; this.loaded = 0; this.complete = false;
    this.mode = 'none';              /* none | codec | video */
    this.decoder = null; this.busy = false; this.gen = 0;
    this.keepRaw = params.get('raw') === '1' || (isWebKit && params.get('raw') !== '0');
    this.cache = new Map(); this.req = new Set();
    this.target = 0; this.dir = 1; this.shown = -1; this.painted = false; this.started = false;
    this.keep = this.tall ? 2 : 1;   /* groups kept on each side of the current one */
    this.stats = {decoded: 0, exact: 0, near: 0, miss: 0, groups: 0, gms: 0, maxLag: 0};
    var self = this;
    if(window.ResizeObserver) new ResizeObserver(function(){ self.resize(); }).observe(this.stage);
    window.addEventListener('resize', function(){ self.resize(); });
    this.resize();
  }
  Film.prototype.resize = function(){
    var w = Math.max(1, Math.round(this.stage.clientWidth * DPR)), h = Math.max(1, Math.round(this.stage.clientHeight * DPR));
    if(this.canvas.width !== w || this.canvas.height !== h){ this.canvas.width = w; this.canvas.height = h; this.shown = -1; this.paint(); }
  };
  Film.prototype.load = function(){
    if(this.started) return; this.started = true;
    var self = this;
    fetch(this.base + '.json').then(function(r){ if(!r.ok) throw new Error('index ' + r.status); return r.json(); }).then(function(meta){
      self.meta = meta;
      var off = new Float64Array(meta.frames + 1), p = meta.first;
      for(var i = 0; i < meta.frames; i++){ off[i] = p; p += meta.sizes[i]; }
      off[meta.frames] = p; self.off = off;
      self.pick();
    }).catch(function(){ self.useVideo(); });
  };
  Film.prototype.pick = function(){
    var self = this, meta = this.meta;
    if(!('VideoDecoder' in window) || !('EncodedVideoChunk' in window) || params.get('engine') === 'video'){ this.useVideo(); return; }
    var cfg = {codec: meta.codec, codedWidth: meta.width, codedHeight: meta.height, optimizeForLatency: true};
    if(meta.description){
      var bin = atob(meta.description), u8 = new Uint8Array(bin.length);
      for(var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      cfg.description = u8;
    }
    this.cfg = cfg;
    var ok;
    try{ ok = VideoDecoder.isConfigSupported(cfg); }catch(e){ this.useVideo(); return; }
    ok.then(function(s){ if(s && s.supported){ self.mode = 'codec'; self.fetchBytes(); } else self.useVideo(); },
            function(){ self.useVideo(); });
  };
  Film.prototype.open = function(){
    var self = this, gen = ++this.gen;
    try{
      this.decoder = new VideoDecoder({
        output: function(frame){ if(gen === self.gen) self.onFrame(frame); else frame.close(); },
        error: function(){ if(gen === self.gen) self.codecFail(); }
      });
      this.decoder.configure(this.cfg);
    }catch(e){ this.codecFail(); }
  };
  Film.prototype.fetchBytes = function(){
    var self = this, meta = this.meta;
    this.abort = window.AbortController ? new AbortController() : null;
    fetch(this.base + '.mp4', this.abort ? {signal: this.abort.signal} : undefined).then(function(resp){
      if(!resp.ok) throw new Error('film ' + resp.status);
      var cl = parseInt(resp.headers.get('Content-Length') || '0', 10);
      if(cl && cl !== meta.bytes) throw new Error('film and index do not match');
      if(!resp.body || !resp.body.getReader){
        return resp.arrayBuffer().then(function(ab){ self.buf = new Uint8Array(ab); self.loaded = self.buf.length; self.complete = true; });
      }
      self.buf = new Uint8Array(meta.bytes);
      var reader = resp.body.getReader();
      var pump = function(){
        return reader.read().then(function(r){
          if(r.done){ self.complete = true; return; }
          if(self.loaded + r.value.length <= self.buf.length){ self.buf.set(r.value, self.loaded); self.loaded += r.value.length; }
          return pump();
        });
      };
      return pump();
    }).catch(function(){ if(self.mode === 'codec' && !self.complete && !self.painted) self.useVideo(); });
  };
  Film.prototype.have = function(g){            /* are the bytes of group g here yet? */
    var m = this.meta, last = Math.min(m.frames, (g + 1) * m.gop);
    return this.buf && this.off[last] <= this.loaded;
  };
  Film.prototype.onFrame = function(frame){
    var self = this, idx = frame.timestamp;
    this.stats.decoded++;
    if(this.keepRaw || !window.createImageBitmap){ this.put(idx, frame); return; }
    var pr;
    try{ pr = createImageBitmap(frame); }catch(e){ this.keepRaw = true; this.put(idx, frame); return; }
    pr.then(function(bmp){ try{ frame.close(); }catch(e){} self.put(idx, bmp); },
            function(){ self.keepRaw = true; self.put(idx, frame); });
  };
  Film.prototype.put = function(idx, img){
    var m = this.meta, cur = Math.floor(this.target / m.gop);
    if(Math.abs(Math.floor(idx / m.gop) - cur) > this.keep){ if(img.close) try{ img.close(); }catch(e){} return; }   /* arrived too late to matter */
    var old = this.cache.get(idx);
    if(old && old.close) try{ old.close(); }catch(e){}
    this.cache.set(idx, img);
    if(this.shown !== this.target) this.paint();
  };
  Film.prototype.codecFail = function(){
    if(this.mode !== 'codec') return;
    this.gen++; this.busy = false;
    this.cache.forEach(function(img){ if(img.close) try{ img.close(); }catch(e){} });
    this.cache.clear(); this.req.clear();
    try{ if(this.decoder && this.decoder.state !== 'closed') this.decoder.close(); }catch(e){}
    this.decoder = null;
    this.fails = (this.fails || 0) + 1;
    this.keepRaw = !this.keepRaw;                  /* try the other way of holding frames before giving up on the decoder */
    if(this.fails <= 2){ this.open(); } else { this.useVideo(); }
  };
  Film.prototype.decodeGroup = function(g){
    var self = this, m = this.meta, a = g * m.gop, b = Math.min(m.frames, a + m.gop), gen = this.gen;
    this.busy = true; this.busySince = performance.now(); this.req.add(g);
    if(!this.firstAsk) this.firstAsk = this.busySince;
    try{
      for(var i = a; i < b; i++){
        this.decoder.decode(new EncodedVideoChunk({type: i === a ? 'key' : 'delta', timestamp: i, duration: 1,
          data: this.buf.subarray(this.off[i], this.off[i + 1])}));
      }
      this.decoder.flush().then(function(){ if(gen === self.gen){ self.stats.groups++; self.stats.gms += performance.now() - self.busySince; self.busy = false; self.schedule(); } },
                                function(){ if(gen === self.gen) self.codecFail(); });
    }catch(e){ this.codecFail(); }
  };
  Film.prototype.schedule = function(){
    if(this.mode !== 'codec' || this.busy || !this.meta) return;
    if(!this.decoder){ this.open(); if(!this.decoder) return; }   /* the decoder is only created when the film is actually on screen */
    var m = this.meta, groups = Math.ceil(m.frames / m.gop), cur = Math.floor(this.target / m.gop), dir = this.dir;
    var want = [cur, cur + dir, cur - dir, cur + 2 * dir];
    /* free frames of groups that are no longer around the current position */
    var keep = this.keep, self = this;
    this.cache.forEach(function(img, idx){
      if(Math.abs(Math.floor(idx / m.gop) - cur) > keep){ if(img.close) try{ img.close(); }catch(err){} self.cache.delete(idx); }
    });
    this.req.forEach(function(g){ if(Math.abs(g - cur) > keep) self.req.delete(g); });
    for(var k = 0; k < want.length; k++){
      var g = want[k];
      if(g < 0 || g >= groups || this.req.has(g) || Math.abs(g - cur) > keep) continue;
      if(!this.have(g)) continue;
      this.decodeGroup(g); return;
    }
  };
  /* a decoder that accepts work but never answers is replaced; after three tries the film falls back to <video> */
  Film.prototype.watch = function(now){
    if(this.mode !== 'codec') return;
    if(this.busy && now - this.busySince > 3500){ this.codecFail(); return; }
    if(!this.painted && this.firstAsk && now - this.firstAsk > 3000){ this.firstAsk = now; this.codecFail(); }
  };
  /* a film that is far off screen gives its decoder and frames back */
  Film.prototype.sleep = function(){
    if(this.mode !== 'codec' || !this.decoder) return;
    this.gen++; this.busy = false; this.firstAsk = 0;
    this.cache.forEach(function(img){ if(img.close) try{ img.close(); }catch(e){} });
    this.cache.clear(); this.req.clear(); this.shown = -1;
    try{ if(this.decoder.state !== 'closed') this.decoder.close(); }catch(e){}
    this.decoder = null;
  };
  Film.prototype.useVideo = function(){
    if(this.mode === 'video') return;
    this.mode = 'video';
    if(this.abort) try{ this.abort.abort(); }catch(e){}
    var self = this, v = d.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'auto';
    v.src = this.base + '.mp4';
    this.video = v;
    var draw = function(){ self.shown = -1; self.paint(); };
    v.addEventListener('seeked', draw); v.addEventListener('loadeddata', draw);
    var kick = function(){
      var p = v.play();
      if(p && p.then) p.then(function(){ v.pause(); window.removeEventListener('pointerdown', kick); window.removeEventListener('touchstart', kick); }).catch(function(){});
    };
    window.addEventListener('pointerdown', kick); window.addEventListener('touchstart', kick, {passive: true}); kick();
  };
  Film.prototype.setTarget = function(frac){
    if(!this.meta){ this.pending = frac; return; }
    var t = Math.round(clamp(frac, 0, 1) * (this.meta.frames - 1));
    if(t !== this.target){ this.dir = t > this.target ? 1 : -1; this.target = t; }
    if(this.mode === 'codec'){ this.schedule(); if(this.shown !== this.target) this.paint(); }
    else if(this.mode === 'video'){
      var v = this.video, time = this.target / this.meta.fps;
      if(v && v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime - time) > 0.012){ try{ v.currentTime = time; }catch(e){} }
    }
  };
  Film.prototype.paint = function(){
    var img = null, idx = -1, m = this.meta;
    if(this.mode === 'codec' && m){
      if(this.cache.has(this.target)){ idx = this.target; }
      else {
        for(var k = 1; k <= 30 && idx < 0; k++){
          if(this.cache.has(this.target - k * this.dir)) idx = this.target - k * this.dir;
          else if(this.cache.has(this.target + k * this.dir)) idx = this.target + k * this.dir;
        }
      }
      if(idx < 0 || idx === this.shown) return;
      img = this.cache.get(idx);
      if(idx === this.target) this.stats.exact++; else this.stats.near++;
    } else if(this.mode === 'video' && this.video && this.video.readyState >= 2){
      img = this.video; idx = this.target;
    }
    if(!img) return;
    var cw = this.canvas.width, ch = this.canvas.height;
    var w = img.videoWidth || img.displayWidth || img.width, h = img.videoHeight || img.displayHeight || img.height;
    if(!w || !h) return;
    var sc = Math.max(cw / w, ch / h), sw = cw / sc, sh = ch / sc;
    try{
      this.ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, cw, ch);
    }catch(e){ return; }
    this.shown = idx;
    if(!this.painted){ this.painted = true; this.scene.classList.add('live'); }
  };
  /* how much of the opening (first five seconds) is ready, 0..1 — the preloader waits on this */
  Film.prototype.ready = function(){
    if(this.mode === 'video') return this.painted ? 1 : (this.video && this.video.readyState >= 2 ? 1 : 0.3);
    if(!this.meta || !this.buf) return 0;
    var need = this.off[Math.min(this.meta.frames, 150)];
    return Math.min(1, this.loaded / need) * (this.painted ? 1 : 0.9);
  };

  /* ---------- scenes: a film pinned to the screen while the page scrolls through it ---------- */
  var scenes = [].slice.call(d.querySelectorAll('.scene[data-film]')).map(function(el){
    var film = new Film(el);
    var chapters = [].slice.call(el.querySelectorAll('.ch')).map(function(c){
      return {el: c, a: parseFloat(c.getAttribute('data-in')), b: parseFloat(c.getAttribute('data-out'))};
    });
    return {
      el: el, film: film, chapters: chapters,
      grow: parseFloat(el.getAttribute('data-grow') || '0'),       /* vh spent opening the frame up to full screen */
      len: parseFloat(el.getAttribute('data-len')),                /* vh of scroll the film itself takes */
      dur: parseFloat(el.getAttribute('data-dur')),
      frame: el.querySelector('.frame'), intro: el.querySelector('.hero-ui'), fin: el.querySelector('.lead'),
      bar: el.querySelector('.prog i'), count: el.querySelector('.count b'),
      last: {ch: -2, fin: null, k: -1, intro: -1, bar: -1},
      glide: {on: false, p: 0, v: 0, t: 0}
    };
  });
  /* ---------- glide: on touch screens the film follows the scroll like a camera with some weight ----------
     A finger moves a page in bursts: a swipe, a slowdown, the next swipe. Tied frame for frame to the scroll, the film
     surged with every swipe and almost stood still in between, several times a second. Here the scroll only says where
     the film should be; the picture travels there on a critically damped spring, so it eases in and out and a run of
     swipes becomes one continuous flight. The chapter titles, the progress line and the closing form follow the
     picture, not the scroll, so they stay in step with what is on screen.
     Not used on desktop (the wheel is already smoothed there) and not while the page scrolls itself (A / ?tour=1),
     where the film keeps the exact frame-for-frame link. ?glide=0 switches it off, ?glide=7 tries another stiffness. */
  var GLIDE = 0;
  var jump = 0, jumpAt = 0, jumpY = -1, jumpStill = 0;            /* a jump from a menu link, the logo or the details button is under way: the film goes straight there, no glide */
  if(coarse && !reduce){ GLIDE = params.has('glide') ? Math.max(0, parseFloat(params.get('glide')) || 0) : 5; }   /* spring stiffness, 1/s */
  function follow(s, f, now){
    var G = s.glide;
    if(!GLIDE || auto || jump || !G.on){ G.on = true; G.p = f; G.v = 0; G.t = now; return f; }
    var dt = Math.min((now - G.t) / 1000, 0.1); G.t = now;
    if(!(dt > 0)) return G.p;
    /* exact step of a critically damped spring towards f: stable at any frame rate */
    var d = G.p - f, e = Math.exp(-GLIDE * dt), c = G.v + GLIDE * d;
    G.p = f + (d + c * dt) * e;
    G.v = (G.v - GLIDE * c * dt) * e;
    var eps = 0.3 / (s.dur * 30);                                 /* a third of a frame */
    if(Math.abs(G.p - f) < eps && Math.abs(G.v) < eps * 4){ G.p = f; G.v = 0; }
    return clamp(G.p, 0, 1);
  }
  function geom(s){
    var vh = vhpx(), r = s.el.getBoundingClientRect(), y = -r.top;
    var growPx = s.grow * vh / 100, lenPx = s.len * vh / 100;
    return {y: y, vh: vh, top: r.top, bottom: r.bottom, growPx: growPx, lenPx: lenPx,
            k: s.grow ? clamp(y / growPx, 0, 1) : 1, f: clamp((y - growPx) / lenPx, 0, 1),
            near: r.bottom > -vh && r.top < vh * 2.5};
  }
  function updateScene(s, now){
    var g = geom(s), L = s.last;
    if(!g.near){ s.film.sleep(); s.glide.on = false; return g; }
    s.film.load();
    var f = follow(s, g.f, now);                                  /* where the picture is; equals g.f whenever the glide is off */
    s.film.setTarget(f);
    /* the wellness film starts as a card on the page and opens to full screen */
    if(s.frame && s.grow){
      var k = Math.round(ease(g.k) * 1000) / 1000;
      if(k !== L.k){
        L.k = k;
        s.frame.style.setProperty('--k', k);
        s.el.classList.toggle('open', k > 0.92);
        s.el.classList.toggle('full', k >= 1);
      }
    }
    var t = f * s.dur, ended = f >= 0.999 && g.y > g.growPx + g.lenPx - 2;
    var on = -1;
    if(!ended){ for(var i = 0; i < s.chapters.length; i++){ if(t >= s.chapters[i].a && t < s.chapters[i].b){ on = i; break; } } }
    else if(s.chapters.length && s.chapters[s.chapters.length - 1].el.hasAttribute('data-stay')) on = s.chapters.length - 1;
    if(on !== L.ch){
      L.ch = on;
      for(var j = 0; j < s.chapters.length; j++) s.chapters[j].el.classList.toggle('on', j === on);
    }
    if(s.fin && ended !== L.fin){ L.fin = ended; s.fin.classList.toggle('on', ended); s.el.classList.toggle('ended', ended); }
    if(s.intro){
      var io = Math.round(clamp(1 - (g.y / (g.vh * 0.55)), 0, 1) * 100) / 100;
      if(io !== L.intro){ L.intro = io; s.intro.style.opacity = io; s.intro.style.transform = 'translate3d(0,' + ((1 - io) * -46).toFixed(1) + 'px,0)'; s.intro.style.visibility = io ? 'visible' : 'hidden'; }
    }
    if(s.bar){
      var b = Math.round(f * 1000) / 1000;
      if(b !== L.bar){ L.bar = b; s.bar.style.transform = 'scaleX(' + b + ')'; }
    }
    return g;
  }

  /* ---------- smooth wheel scrolling on desktop; phones keep their own native scrolling ---------- */
  var lenis = null;
  if(window.Lenis && !coarse && !reduce){
    try{ lenis = new window.Lenis({lerp: 0.11, wheelMultiplier: 0.9, smoothWheel: true}); }catch(e){ lenis = null; }
  }
  function scrollToEl(el, immediate){
    var y = el.getBoundingClientRect().top + (window.scrollY || window.pageYOffset) + parseFloat(el.getAttribute('data-offset') || '0') * vhpx() / 100;
    if(lenis) lenis.scrollTo(y, {immediate: !!immediate, duration: 1.6});
    else window.scrollTo({top: y, behavior: immediate || reduce ? 'auto' : 'smooth'});
  }
  d.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if(!a) return;
    var el = d.getElementById(a.getAttribute('href').slice(1));
    if(!el) return;
    e.preventDefault(); stopAuto(); jump = 1; jumpAt = performance.now(); jumpStill = 0; scrollToEl(el);
  });

  /* ---------- ordinary sections: reveals, word-by-word statement, counters, the sideways rail ---------- */
  var reveals = [].slice.call(d.querySelectorAll('[data-rv]'));
  if(reduce || !window.IntersectionObserver){ reveals.forEach(function(el){ el.classList.add('in'); }); }
  else {
    var rio = new IntersectionObserver(function(es){
      es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); rio.unobserve(en.target); } });
    }, {rootMargin: '0px 0px -10% 0px', threshold: 0.12});
    reveals.forEach(function(el){ rio.observe(el); });
  }
  var say = d.querySelector('.say'), words = [];
  if(say){
    var parts = say.textContent.trim().split(/\s+/); say.textContent = '';
    parts.forEach(function(w, i){
      var sp = d.createElement('span'); sp.textContent = w; say.appendChild(sp); words.push(sp);
      if(i < parts.length - 1) say.appendChild(d.createTextNode(' '));
    });
    if(reduce) words.forEach(function(w){ w.classList.add('lit'); });
  }
  var lit = -1;
  function updateSay(vh){
    if(!say || reduce) return;
    var r = say.getBoundingClientRect();
    var p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.36), 0, 1), n = Math.round(p * words.length);
    if(n !== lit){ lit = n; for(var i = 0; i < words.length; i++) words[i].classList.toggle('lit', i < n); }
  }
  var counters = [].slice.call(d.querySelectorAll('[data-count]'));
  function runCounter(el){
    var to = parseFloat(el.getAttribute('data-count')), t0 = null, dur = 1400;
    if(reduce){ el.textContent = to; return; }
    function step(now){
      if(t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(to * e);
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if(window.IntersectionObserver){
    var cio = new IntersectionObserver(function(es){
      es.forEach(function(en){ if(en.isIntersecting){ runCounter(en.target); cio.unobserve(en.target); } });
    }, {threshold: 0.6});
    counters.forEach(function(el){ cio.observe(el); });
  } else counters.forEach(function(el){ el.textContent = el.getAttribute('data-count'); });

  var rail = d.querySelector('.places'), track = rail ? rail.querySelector('.track') : null, railX = -1, railOver = 0;
  var railBar = rail ? rail.querySelector('.rail-prog i') : null, railPics = rail ? [].slice.call(rail.querySelectorAll('.pic img')) : [];
  var railW = 0, railH = 0;
  function sizeRail(){
    if(!rail) return;
    VH = vhProbe.offsetHeight || window.innerHeight;
    var vp = track.parentNode, cs = getComputedStyle(vp);
    railOver = Math.max(0, track.scrollWidth - (vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    var h = vhpx() + railOver;
    if(h !== railH){ railH = h; rail.style.height = h + 'px'; railX = -1; }
  }
  function updateRail(vh){
    if(!rail) return;
    var r = rail.getBoundingClientRect(), p = clamp(-r.top / Math.max(1, r.height - vh), 0, 1), x = Math.round(p * railOver);
    if(x !== railX){
      railX = x; track.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
      if(railBar) railBar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
      if(!reduce){
        var vw = window.innerWidth;
        for(var i = 0; i < railPics.length; i++){
          var pr = railPics[i].parentNode.getBoundingClientRect(), mid = (pr.left + pr.width / 2 - vw / 2) / vw;
          railPics[i].style.transform = 'translate3d(' + (mid * -9).toFixed(2) + '%,0,0) scale(1.2)';
        }
      }
    }
  }
  window.addEventListener('resize', sizeRail);
  window.addEventListener('load', sizeRail);
  if(d.fonts && d.fonts.ready) d.fonts.ready.then(sizeRail);
  sizeRail();

  /* nav colour follows what is under it */
  var nav = d.getElementById('nav'), themed = [].slice.call(d.querySelectorAll('[data-theme]')), navTheme = null;
  function updateNav(){
    if(!nav) return;
    var y = 34, th = 'ink';
    for(var i = 0; i < themed.length; i++){
      var r = themed[i].getBoundingClientRect();
      if(r.top <= y && r.bottom > y){
        th = themed[i].getAttribute('data-theme');
        if(th === 'grow') th = themed[i].classList.contains('open') ? 'film' : 'ink';
      }
    }
    if(th !== navTheme){ navTheme = th; nav.setAttribute('data-on', th); }
  }

  /* ---------- A = the page scrolls itself, for screen-recording a reel. AUTO_BASE is the speed A starts at, relative to the films' natural speed ---------- */
  var AUTO_BASE = 1.3;
  /* extra speed per film while the page scrolls itself: the opening flight moves about a third slower on screen than the second film, so on its own speed the tour started too slowly */
  var AUTO_FILM = {arrival: 1.55};
  var auto = 0, autoLast = 0, autoMult = AUTO_BASE, autoY = 0;
  function stopAuto(){
    if(!auto) return;
    cancelAnimationFrame(auto); auto = 0;
    if(lenis) lenis.start();
    body.classList.remove('touring');
  }
  function startAuto(){
    if(auto) return;
    if(lenis) lenis.stop();
    body.classList.add('touring');
    autoLast = performance.now(); autoY = window.scrollY || window.pageYOffset;
    var step = function(now){
      var dt = Math.min((now - autoLast) / 1000, 0.1); autoLast = now;
      var vh = vhpx(), speed = vh * 0.42;                       /* ordinary sections */
      for(var i = 0; i < scenes.length; i++){
        var s = scenes[i], g = geom(s);
        if(g.y >= g.growPx && g.y < g.growPx + g.lenPx){ speed = g.lenPx / s.dur * (AUTO_FILM[s.film.name] || 1); break; }   /* inside a film: real time, times that film's own factor */
      }
      /* the position is kept as a fraction here: the browser rounds scrollY to whole pixels, and adding to the rounded value each frame made the real speed drift from the requested one */
      var cur = window.scrollY || window.pageYOffset; if(Math.abs(cur - autoY) > 3) autoY = cur;
      autoY += speed * autoMult * dt;
      var max = docEl.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(autoY, max));
      if(autoY >= max - 1){ stopAuto(); return; }
      auto = requestAnimationFrame(step);
    };
    auto = requestAnimationFrame(step);
  }
  window.addEventListener('wheel', stopAuto, {passive: true});
  window.addEventListener('touchstart', stopAuto, {passive: true});
  window.addEventListener('touchstart', function(){ jump = 0; }, {passive: true});
  window.addEventListener('keydown', function(e){
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.key === '1' || e.key === '2' || e.key === '3'){ autoMult = e.key === '1' ? AUTO_BASE : (e.key === '2' ? 1.5 : 2); return; }
    if(e.key === 'a' || e.key === 'A'){ if(!e.repeat){ if(auto) stopAuto(); else startAuto(); } return; }
    if(auto && /^(Arrow|Page|Home|End|Escape| )/.test(e.key)) stopAuto();
  });

  /* ---------- frame loop ---------- */
  function loop(now){
    if(lenis) lenis.raf(now);
    if(jump){                                                    /* the jump is over once the page has stood still for a moment */
      var jy = window.scrollY || window.pageYOffset;
      if(Math.abs(jy - jumpY) < 0.5){ if(++jumpStill > 12 && now - jumpAt > 400) jump = 0; } else jumpStill = 0;
      jumpY = jy;
    }
    var vh = vhpx();
    for(var i = 0; i < scenes.length; i++){ updateScene(scenes[i], now); scenes[i].film.watch(now); }
    if(scenes.length > 1 && scenes[0].film.complete) scenes[1].film.load();     /* the second film downloads quietly once the first is in */
    updateSay(vh); updateRail(vh); updateNav();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- preloader: lifts once the opening of the first film is on screen ---------- */
  var pre = d.getElementById('pre'), preNum = pre ? pre.querySelector('.pre-n') : null, preBar = pre ? pre.querySelector('.pre-bar i') : null;
  var shownP = 0, t0 = performance.now(), lifted = false;
  function lift(){
    if(lifted) return; lifted = true;
    body.classList.add('ready');
    if(pre) setTimeout(function(){ pre.style.display = 'none'; }, 1300);
    if(params.get('tour') === '1') setTimeout(startAuto, 1500);
  }
  function preTick(){
    if(lifted) return;
    var el = (performance.now() - t0) / 1000;
    var real = scenes.length ? scenes[0].film.ready() : 1;
    var goal = Math.max(real, Math.min(0.9, el / 9));            /* never hangs: after a while it goes anyway */
    shownP += (goal - shownP) * 0.12;
    if(preNum) preNum.textContent = ('0' + Math.round(shownP * 100)).slice(-2 - (shownP >= 0.995 ? 1 : 0));
    if(preBar) preBar.style.transform = 'scaleX(' + shownP.toFixed(3) + ')';
    if((real >= 1 && shownP > 0.97 && el > 1.1) || el > 9){ if(preNum) preNum.textContent = '100'; lift(); return; }
    requestAnimationFrame(preTick);
  }
  if(scenes.length) scenes[0].film.load();
  if(pre) requestAnimationFrame(preTick); else lift();

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
      var name = d.getElementById('fn').value.trim(), phone = d.getElementById('ph').value.trim(),
          mail = d.getElementById('em').value.trim(), type = d.getElementById('tp').value;
      if(!name || !phone){ fail('נא למלא שם מלא וטלפון.'); return; }
      if(!type){ fail('נא לבחור סוג חופשה.'); return; }
      var text = 'שלום, אשמח לקבל פרטים על חופשה ב-' + BRAND + '.\n' + 'שם: ' + name + '\n' + 'טלפון: ' + phone + '\n'
               + (mail ? 'אימייל: ' + mail + '\n' : '') + 'סוג החופשה: ' + type;
      var wa = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text);
      window.open(wa, '_blank', 'noopener');
      btn.disabled = true; form.style.display = 'none';
      var old = form.parentNode.querySelector('.err'); if(old) old.remove();
      var done = d.createElement('div'); done.className = 'done';
      var first = name.split(' ')[0];
      done.appendChild(d.createTextNode('תודה' + (first ? ' ' + first : '') + '. נפתח וואטסאפ עם הפרטים, נשאר רק ללחוץ שליחה.'));
      done.appendChild(d.createElement('br'));
      done.appendChild(d.createTextNode('לא נפתח? '));
      var a1 = d.createElement('a'); a1.href = wa; a1.target = '_blank'; a1.rel = 'noopener'; a1.textContent = 'לחצו כאן';
      done.appendChild(a1);
      done.appendChild(d.createTextNode(' או שלחו מייל ל־'));
      var a2 = d.createElement('a'); a2.href = 'mailto:' + MAIL; a2.textContent = MAIL; a2.dir = 'ltr';
      done.appendChild(a2); done.appendChild(d.createTextNode('.'));
      form.insertAdjacentElement('afterend', done);
    });
  }

  if(params.get('debug') === '1'){
    var dbg = d.createElement('div');
    dbg.style.cssText = 'position:fixed;left:8px;top:64px;z-index:999;background:rgba(0,0,0,.8);color:#fff;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;border-radius:8px;white-space:pre;pointer-events:none;direction:ltr;text-align:left';
    body.appendChild(dbg);
    var gaps = [], lastT = performance.now(), longF = 0, worst = 0, nT = 0;
    var tick = function(now){
      var g = now - lastT; lastT = now; gaps.push(g); if(gaps.length > 90) gaps.shift();
      if(g > 34) longF++; if(g > worst) worst = g;
      var act = null;
      for(var i = 0; i < scenes.length; i++){ var r = scenes[i].el.getBoundingClientRect(); if(r.top < VH && r.bottom > 0){ act = scenes[i].film; break; } }
      if(act && act.meta && act.mode === 'codec' && act.shown >= 0){ var lag = Math.abs(act.shown - act.target); if(lag > act.stats.maxLag) act.stats.maxLag = lag; }
      if(++nT % 12 === 0){
        var avg = gaps.reduce(function(a, c){ return a + c; }, 0) / gaps.length, lines = [];
        lines.push('fps ' + (1000 / avg).toFixed(0) + '  long ' + longF + '  worst ' + worst.toFixed(0) + 'ms');
        lines.push('inner ' + window.innerHeight + '  vh ' + VH + '  dpr ' + (window.devicePixelRatio || 1));
        if(act){
          var st = act.stats, m = act.meta;
          lines.push('engine ' + act.mode + (act.mode === 'codec' ? (act.keepRaw ? ' raw' : ' bitmap') : '') + '  fails ' + (act.fails || 0));
          lines.push((m ? m.codec + ' ' + m.width + 'x' + m.height : 'no index') + '  canvas ' + act.canvas.width + 'x' + act.canvas.height);
          lines.push('loaded ' + (act.loaded / 1e6).toFixed(1) + '/' + (m ? (m.bytes / 1e6).toFixed(1) : '?') + ' MB' + (act.complete ? ' done' : ''));
          lines.push('frame ' + act.shown + '/' + act.target + '  max lag ' + st.maxLag + '  cache ' + act.cache.size);
          lines.push('groups ' + st.groups + '  ' + (st.groups ? (st.gms / st.groups).toFixed(0) : '-') + ' ms each  exact ' + st.exact + ' near ' + st.near);
        } else lines.push('no film on screen');
        dbg.textContent = lines.join('\n');
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* for testing from the console / automated checks */
  window.__site = {scenes: scenes, startAuto: startAuto, stopAuto: stopAuto, lenis: function(){ return lenis; }, glide: GLIDE};
})();
