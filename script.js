(function(){
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- shared app state (mirrors the server) ---------------- */
  var state = { quests: [], xp: 0, sessions: 0 };
  var syncStatus = document.getElementById('syncStatus');

  function setSyncStatus(text, isError){
    syncStatus.textContent = text;
    syncStatus.style.color = isError ? '#e6304a' : '';
  }

  async function api(path, options){
    try{
      var res = await fetch(path, options);
      if(!res.ok){
        var body = await res.json().catch(function(){ return {}; });
        throw new Error(body.error || ('Request failed (' + res.status + ')'));
      }
      setSyncStatus('Synced with server', false);
      return await res.json();
    }catch(err){
      setSyncStatus('Offline — changes not saved', true);
      throw err;
    }
  }

  /* ---------------- click ripple, on every .btn ---------------- */
  function spawnRipple(e){
    if(reduceMotion) return;
    var btn = e.currentTarget;
    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.4;
    var ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    var x = (e.clientX || rect.left + rect.width/2) - rect.left - size/2;
    var y = (e.clientY || rect.top + rect.height/2) - rect.top - size/2;
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', function(){ ripple.remove(); });
  }
  function wireRipples(){
    document.querySelectorAll('.btn').forEach(function(btn){
      btn.removeEventListener('click', spawnRipple);
      btn.addEventListener('click', spawnRipple);
    });
  }

  /* ---------------- Pomodoro timer (client-side clock; sprints logged to server) ---------------- */
  var workInput = document.getElementById('workMin');
  var breakInput = document.getElementById('breakMin');
  var clockEl = document.getElementById('timerClock');
  var modeEl = document.getElementById('timerMode');
  var btnStart = document.getElementById('btnStart');
  var btnPause = document.getElementById('btnPause');
  var btnReset = document.getElementById('btnReset');

  var isWork = true;
  var secondsLeft = parseInt(workInput.value,10) * 60;
  var timerId = null;

  function formatTime(s){
    var m = Math.floor(s/60);
    var sec = s % 60;
    return (m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
  }

  function renderClock(){
    clockEl.textContent = formatTime(secondsLeft);
    modeEl.textContent = isWork ? 'WORK' : 'BREAK';
    modeEl.className = 'timer-mode' + (isWork ? '' : ' break');
  }

  async function switchMode(completedWork){
    isWork = !isWork;
    var mins = isWork ? parseInt(workInput.value,10) : parseInt(breakInput.value,10);
    secondsLeft = (mins || (isWork?25:5)) * 60;
    renderClock();
    if(completedWork){
      try{
        var updated = await api('/api/sessions', { method:'POST' });
        state = updated;
        renderQuests();
        renderStats();
      }catch(err){ /* status already shown */ }
    }
  }

  function tick(){
    secondsLeft -= 1;
    if(secondsLeft < 0){
      switchMode(isWork);
      return;
    }
    renderClock();
  }

  btnStart.addEventListener('click', function(){
    if(timerId) return;
    timerId = setInterval(tick, 1000);
  });
  btnPause.addEventListener('click', function(){
    clearInterval(timerId);
    timerId = null;
  });
  btnReset.addEventListener('click', function(){
    clearInterval(timerId);
    timerId = null;
    isWork = true;
    secondsLeft = (parseInt(workInput.value,10) || 25) * 60;
    renderClock();
  });
  workInput.addEventListener('change', function(){
    if(isWork && !timerId){
      secondsLeft = (parseInt(workInput.value,10) || 25) * 60;
      renderClock();
    }
  });
  breakInput.addEventListener('change', function(){
    if(!isWork && !timerId){
      secondsLeft = (parseInt(breakInput.value,10) || 5) * 60;
      renderClock();
    }
  });

  renderClock();

  /* ---------------- Quest log ---------------- */
  var questForm = document.getElementById('questForm');
  var questInput = document.getElementById('questInput');
  var questList = document.getElementById('questList');
  var questError = document.getElementById('questError');

  function showQuestError(msg){
    questError.textContent = msg;
    questError.hidden = false;
  }
  function clearQuestError(){
    questError.hidden = true;
  }

  function renderQuests(){
    questList.innerHTML = '';
    if(state.quests.length === 0){
      var empty = document.createElement('li');
      empty.className = 'quest-empty';
      empty.textContent = 'No quests yet — add one above.';
      questList.appendChild(empty);
      return;
    }
    state.quests.forEach(function(q){
      var li = document.createElement('li');
      li.className = 'quest' + (q.done ? ' done' : '');
      li.dataset.id = q.id;

      var check = document.createElement('button');
      check.className = 'quest-check';
      check.type = 'button';
      check.setAttribute('aria-label', q.done ? 'Mark quest incomplete' : 'Mark quest complete');
      if(q.done){
        var mark = document.createElement('span');
        mark.textContent = '✓';
        check.appendChild(mark);
      }
      check.addEventListener('click', function(){ toggleQuest(q, li); });

      var text = document.createElement('span');
      text.className = 'quest-text';
      text.textContent = q.text;

      var xp = document.createElement('span');
      xp.className = 'quest-xp';
      xp.textContent = '+10 XP';

      var del = document.createElement('button');
      del.className = 'quest-del';
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete quest');
      del.textContent = '×';
      del.addEventListener('click', function(){ deleteQuest(q.id); });

      li.appendChild(check);
      li.appendChild(text);
      li.appendChild(xp);
      li.appendChild(del);
      questList.appendChild(li);
    });
    wireRipples();
  }

  async function toggleQuest(quest, rowEl){
    var goingDone = !quest.done;
    try{
      var updated = await api('/api/quests/' + encodeURIComponent(quest.id), {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ done: goingDone })
      });
      state = updated;
      renderQuests();
      renderStats();
      if(goingDone && !reduceMotion){
        var row = questList.querySelector('[data-id="' + quest.id + '"]');
        if(row){
          row.classList.add('just-cleared');
          row.addEventListener('animationend', function(){ row.classList.remove('just-cleared'); }, {once:true});
        }
      }
    }catch(err){ /* status already shown */ }
  }

  async function deleteQuest(id){
    try{
      var updated = await api('/api/quests/' + encodeURIComponent(id), { method:'DELETE' });
      state = updated;
      renderQuests();
      renderStats();
    }catch(err){ /* status already shown */ }
  }

  questForm.addEventListener('submit', async function(e){
    e.preventDefault();
    clearQuestError();
    var val = questInput.value.trim();
    if(!val) return;
    try{
      var updated = await api('/api/quests', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text: val })
      });
      state = updated;
      questInput.value = '';
      renderQuests();
      renderStats();
    }catch(err){
      showQuestError(err.message || 'Could not add that quest.');
    }
  });

  /* ---------------- Power meter ---------------- */
  var statLevel = document.getElementById('statLevel');
  var statXP = document.getElementById('statXP');
  var statSessions = document.getElementById('statSessions');
  var xpBar = document.getElementById('xpBar');

  function bump(el, newText){
    if(el.textContent === String(newText)) return;
    el.textContent = newText;
    if(reduceMotion) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function renderStats(){
    var level = Math.floor(state.xp / 100) + 1;
    var progress = state.xp % 100;
    bump(statLevel, level);
    bump(statXP, state.xp);
    bump(statSessions, state.sessions);
    xpBar.style.width = progress + '%';
    if(!reduceMotion){
      xpBar.classList.remove('pulse');
      void xpBar.offsetWidth;
      xpBar.classList.add('pulse');
    }
  }

  /* ---------------- Sensei tips (client-side content, no server round trip needed) ---------------- */
  var tips = [
    'A messy first draft beats a perfect plan you never started.',
    'Twenty-five focused minutes beats three distracted hours.',
    'Rest is part of training, not a break from it.',
    'You don\u2019t need motivation. You need the next small rep.',
    'Review what confused you yesterday before learning something new today.',
    'Small quests cleared daily beat one giant quest cleared never.',
    'Progress is quiet. Show up anyway.'
  ];
  var tipIdx = 0;
  var tipText = document.getElementById('tipText');
  var btnNextTip = document.getElementById('btnNextTip');
  var tipBox = document.querySelector('.tip-box');

  btnNextTip.addEventListener('click', function(){
    tipIdx = (tipIdx + 1) % tips.length;
    tipText.textContent = tips[tipIdx];
    if(!reduceMotion){
      tipBox.classList.remove('shake');
      void tipBox.offsetWidth;
      tipBox.classList.add('shake');
    }
  });

  /* ---------------- boot: load state from the server ---------------- */
  async function boot(){
    wireRipples();
    try{
      state = await api('/api/state');
    }catch(err){
      state = { quests: [], xp: 0, sessions: 0 };
    }
    renderQuests();
    renderStats();
  }

  boot();

})();