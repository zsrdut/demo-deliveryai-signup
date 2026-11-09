(function () {
  'use strict';

  var state = {
    total: 0,
    limit: 50,
    loggingIn: false,
    exporting: false
  };

  var el = {
    loginPanel: document.getElementById('login-panel'),
    dashboard: document.getElementById('dashboard'),
    loginForm: document.getElementById('login-form'),
    password: document.getElementById('password'),
    loginError: document.getElementById('login-error'),
    loginSubmit: document.getElementById('login-submit'),
    total: document.getElementById('total'),
    list: document.getElementById('list'),
    listStatus: document.getElementById('list-status'),
    retry: document.getElementById('retry'),
    exportButton: document.getElementById('export'),
    exportHint: document.getElementById('export-hint')
  };

  function showLogin(message) {
    el.loginPanel.hidden = false;
    el.dashboard.hidden = true;
    el.loginError.textContent = message || '';
    el.password.value = '';
    el.password.focus();
  }

  function showDashboard() {
    el.loginPanel.hidden = true;
    el.dashboard.hidden = false;
    el.loginError.textContent = '';
  }

  function setListStatus(message, isError) {
    el.listStatus.textContent = message || '';
    if (isError) {
      el.listStatus.classList.add('error');
    } else {
      el.listStatus.classList.remove('error');
    }
  }

  function renderRows(registrations) {
    el.list.textContent = '';

    if (!registrations.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 5;
      emptyCell.className = 'empty';
      emptyCell.textContent = '暂无报名（当前实例）';
      emptyRow.appendChild(emptyCell);
      el.list.appendChild(emptyRow);
      return;
    }

    var fragment = document.createDocumentFragment();
    registrations.forEach(function (record) {
      var row = document.createElement('tr');
      var values = [
        record.position,
        record.name,
        record.employeeId,
        record.department,
        record.registeredAt
      ];
      values.forEach(function (value, index) {
        var cell = document.createElement('td');
        if (index === 0) cell.className = 'pos';
        cell.textContent = String(value === null || value === undefined ? '' : value);
        row.appendChild(cell);
      });
      fragment.appendChild(row);
    });
    el.list.appendChild(fragment);
  }

  function render(data) {
    var registrations = data && Array.isArray(data.registrations) ? data.registrations : [];
    state.total = typeof data.total === 'number' ? data.total : registrations.length;
    state.limit = typeof data.limit === 'number' ? data.limit : 50;

    el.total.textContent = String(state.total);
    renderRows(registrations);

    var empty = state.total === 0;
    el.exportButton.disabled = empty || state.exporting;
    el.exportHint.textContent = empty ? '暂无报名可导出' : '';
  }

  function readJson(response) {
    return response.json().catch(function () {
      return null;
    });
  }

  function loadRegistrations(silent) {
    setListStatus('正在加载名单…', false);
    el.retry.hidden = true;

    return fetch('/api/admin/registrations', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
      .then(function (response) {
        if (response.status === 401) return { unauthorized: true };
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) throw new Error('EMPTY');
        if (data.unauthorized) {
          showLogin(silent ? '' : '请重新输入管理口令');
          return;
        }
        render(data);
        showDashboard();
        setListStatus('', false);
        el.retry.hidden = true;
      })
      .catch(function () {
        state.total = 0;
        el.total.textContent = '—';
        el.list.textContent = '';
        el.exportButton.disabled = true;
        el.exportHint.textContent = '';
        showDashboard();
        setListStatus('名单加载失败，请重试', true);
        el.retry.hidden = false;
      });
  }

  function onLogin(event) {
    event.preventDefault();
    if (state.loggingIn) return;

    var password = el.password.value;
    if (!password) {
      el.loginError.textContent = '请输入管理口令';
      el.password.focus();
      return;
    }

    state.loggingIn = true;
    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = '校验中…';
    el.loginError.textContent = '';

    fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ password: password })
    })
      .then(function (response) {
        return readJson(response).then(function (data) {
          return { response: response, data: data || {} };
        });
      })
      .then(function (result) {
        if (result.response.ok && result.data.authenticated) {
          showDashboard();
          return loadRegistrations(false);
        }
        var message = result.data.error && result.data.error.message
          ? result.data.error.message
          : '口令错误，请重试';
        el.loginError.textContent = message;
        el.password.value = '';
        el.password.focus();
        return null;
      })
      .catch(function () {
        el.loginError.textContent = '登录失败，请重试';
      })
      .then(function () {
        state.loggingIn = false;
        el.loginSubmit.disabled = false;
        el.loginSubmit.textContent = '进入名单';
      });
  }

  function fallbackFilename() {
    var parts = {};
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    formatter.formatToParts(new Date()).forEach(function (part) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    var stamp = parts.year + parts.month + parts.day + '-' + parts.hour + parts.minute;
    return '技术分享会报名名单_当前实例_' + stamp + '.csv';
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function onExport() {
    if (state.exporting || state.total === 0) return;

    state.exporting = true;
    el.exportButton.disabled = true;
    el.exportButton.textContent = '导出中…';
    setListStatus('', false);
    el.retry.hidden = true;

    fetch('/api/admin/export', {
      method: 'GET',
      headers: { Accept: 'text/csv' },
      cache: 'no-store'
    })
      .then(function (response) {
        if (response.status === 401) return { unauthorized: true };
        if (response.status === 409) return { empty: true };
        if (!response.ok) throw new Error('HTTP ' + response.status);

        var filename = null;
        var encoded = response.headers.get('X-Export-Filename');
        if (encoded) {
          try {
            filename = decodeURIComponent(encoded);
          } catch (error) {
            filename = null;
          }
        }
        return response.blob().then(function (blob) {
          return { blob: blob, filename: filename || fallbackFilename() };
        });
      })
      .then(function (result) {
        if (!result) return;
        if (result.unauthorized) {
          showLogin('请重新输入管理口令');
          return;
        }
        if (result.empty) {
          // 页面可能来自其他实例或实例已重置，重新读取当前实例状态。
          return loadRegistrations(false);
        }
        triggerDownload(result.blob, result.filename);
      })
      .catch(function () {
        setListStatus('导出失败，请重试', true);
      })
      .then(function () {
        state.exporting = false;
        el.exportButton.textContent = '导出 CSV';
        el.exportButton.disabled = state.total === 0;
      });
  }

  el.loginForm.addEventListener('submit', onLogin);
  el.exportButton.addEventListener('click', onExport);
  el.retry.addEventListener('click', function () {
    loadRegistrations(false);
  });

  loadRegistrations(true);
})();
