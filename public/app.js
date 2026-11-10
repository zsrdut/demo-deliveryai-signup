(function () {
  'use strict';

  // 与后端默认长度上限保持一致；修改时需同步 server.js / src/vercel.js 环境变量默认值。
  var MAX_NAME = 50;
  var MAX_EMPLOYEE_ID = 50;
  var MAX_DEPARTMENT = 100;

  var state = {
    submitting: false,
    full: false
  };

  var el = {
    form: document.getElementById('signup-form'),
    name: document.getElementById('name'),
    employeeId: document.getElementById('employee-id'),
    department: document.getElementById('department'),
    nameError: document.getElementById('name-error'),
    employeeIdError: document.getElementById('employee-id-error'),
    departmentError: document.getElementById('department-error'),
    submit: document.getElementById('submit'),
    formError: document.getElementById('form-error'),
    result: document.getElementById('result'),
    resultTitle: document.getElementById('result-title'),
    resultText: document.getElementById('result-text'),
    capacityText: document.getElementById('capacity-text'),
    capacityCount: document.getElementById('capacity-count'),
    total: document.getElementById('total')
  };

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function setFieldError(input, node, message) {
    node.textContent = message || '';
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function setFormError(message) {
    el.formError.textContent = message || '';
  }

  function clearErrors() {
    setFieldError(el.name, el.nameError, '');
    setFieldError(el.employeeId, el.employeeIdError, '');
    setFieldError(el.department, el.departmentError, '');
    setFormError('');
  }

  function setSubmitting(on) {
    state.submitting = on;
    el.submit.disabled = on || state.full;
    el.submit.setAttribute('aria-busy', on ? 'true' : 'false');
    el.submit.textContent = on ? '提交中…' : (state.full ? '报名已满' : '提交报名');
  }

  function setFull(full) {
    state.full = full;
    if (full) {
      el.capacityText.textContent = '报名已满（50/50）';
      el.capacityCount.hidden = true;
      el.submit.disabled = true;
      el.submit.textContent = '报名已满';
    } else {
      el.capacityText.textContent = '报名限 50 人';
      el.capacityCount.hidden = false;
      el.submit.disabled = state.submitting;
      el.submit.textContent = '提交报名';
    }
  }

  function hideResult() {
    el.result.hidden = true;
    el.result.className = 'card result';
    el.resultTitle.textContent = '';
    el.resultText.textContent = '';
  }

  function showResult(kind, title, text) {
    el.result.hidden = false;
    el.result.className = 'card result result-' + kind;
    el.resultTitle.textContent = title;
    el.resultText.textContent = text;
  }

  function validate() {
    clearErrors();

    var value = {
      name: el.name.value.trim(),
      employeeId: el.employeeId.value.trim(),
      department: el.department.value.trim()
    };
    var firstInvalid = null;

    if (!value.name) {
      setFieldError(el.name, el.nameError, '请输入姓名');
      firstInvalid = el.name;
    } else if (codePointLength(value.name) > MAX_NAME) {
      setFieldError(el.name, el.nameError, '姓名最多 ' + MAX_NAME + ' 字');
      firstInvalid = el.name;
    }

    if (!value.employeeId) {
      setFieldError(el.employeeId, el.employeeIdError, '请输入工号');
      firstInvalid = firstInvalid || el.employeeId;
    } else if (codePointLength(value.employeeId) > MAX_EMPLOYEE_ID) {
      setFieldError(el.employeeId, el.employeeIdError, '工号最多 ' + MAX_EMPLOYEE_ID + ' 字');
      firstInvalid = firstInvalid || el.employeeId;
    }

    if (!value.department) {
      setFieldError(el.department, el.departmentError, '请输入部门');
      firstInvalid = firstInvalid || el.department;
    } else if (codePointLength(value.department) > MAX_DEPARTMENT) {
      setFieldError(el.department, el.departmentError, '部门最多 ' + MAX_DEPARTMENT + ' 字');
      firstInvalid = firstInvalid || el.department;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    return value;
  }

  function applyServerErrors(errors) {
    if (!errors || typeof errors !== 'object') return;

    var mapping = [
      { key: 'name', input: el.name, node: el.nameError },
      { key: 'employeeId', input: el.employeeId, node: el.employeeIdError },
      { key: 'department', input: el.department, node: el.departmentError }
    ];
    for (var i = 0; i < mapping.length; i += 1) {
      var item = mapping[i];
      var error = errors[item.key];
      if (error && error.message) setFieldError(item.input, item.node, error.message);
    }
  }

  function readJson(response) {
    return response.json().catch(function () {
      return null;
    });
  }

  function refreshStatus() {
    return fetch('/api/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (data && typeof data.total === 'number') {
          el.total.textContent = String(data.total);
        }
        if (data && data.full) setFull(true);
      })
      .catch(function () {
        // 状态读取失败不阻塞报名；提交时仍以服务端结果为准。
      });
  }

  function onSubmit(event) {
    event.preventDefault();
    if (state.submitting || state.full) return;

    hideResult();
    var value = validate();
    if (!value) return;

    setSubmitting(true);

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, 15000)
      : null;

    fetch('/api/registrations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(value),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        return readJson(response).then(function (data) {
          return { response: response, data: data || {} };
        });
      })
      .then(function (result) {
        var response = result.response;
        var data = result.data;

        if (response.status === 201 && data.status === 'SUCCESS') {
          showResult('success', '报名成功', '报名成功，你是第 ' + data.position + ' 位');
          if (typeof data.limit === 'number' && data.limit === data.position) setFull(true);
          return refreshStatus();
        }

        if (response.status === 200 && data.status === 'DUPLICATE') {
          showResult('info', '已报名', '你已报名，第 ' + data.position + ' 位');
          return refreshStatus();
        }

        if (response.status === 409 && data.status === 'FULL') {
          setFull(true);
          showResult('error', '报名已满', '报名已满（50/50）');
          return null;
        }

        if (response.status === 400 && data.status === 'INVALID') {
          applyServerErrors(data.errors);
          setFormError('请检查填写内容');
          return null;
        }

        throw new Error('HTTP ' + response.status);
      })
      .catch(function () {
        setFormError('提交失败，请重试');
      })
      .then(function () {
        if (timeout) window.clearTimeout(timeout);
        setSubmitting(false);
      });
  }

  el.form.addEventListener('submit', onSubmit);

  el.name.addEventListener('input', function () {
    if (el.nameError.textContent) setFieldError(el.name, el.nameError, '');
    if (el.formError.textContent) setFormError('');
  });

  el.employeeId.addEventListener('input', function () {
    if (el.employeeIdError.textContent) setFieldError(el.employeeId, el.employeeIdError, '');
    if (el.formError.textContent) setFormError('');
  });

  el.department.addEventListener('input', function () {
    if (el.departmentError.textContent) setFieldError(el.department, el.departmentError, '');
    if (el.formError.textContent) setFormError('');
  });

  refreshStatus();
})();
