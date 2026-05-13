<script setup lang="ts">
import { ref } from 'vue';
import { login, register, type AuthUser } from './api';

const emit = defineEmits<{ login: [user: AuthUser] }>();

const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  busy.value = true;
  try {
    const user = mode.value === 'login'
      ? await login(username.value, password.value)
      : await register(username.value, password.value, displayName.value || username.value);
    emit('login', user);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-shell">
    <div class="login-card">
      <div class="brand">
        <span class="mark">SO</span>
        <div>
          <h1>方案生成 Agent</h1>
          <p>需求到投标工作台</p>
        </div>
      </div>

      <form @submit.prevent="submit">
        <div class="tabs">
          <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button type="button" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        </div>

        <input v-model="username" placeholder="用户名" autocomplete="username" />
        <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
        <input v-if="mode === 'register'" v-model="displayName" placeholder="显示名称（可选）" />

        <p v-if="error" class="error">{{ error }}</p>

        <button :disabled="busy">{{ mode === 'login' ? '登录' : '注册' }}</button>
      </form>
    </div>
  </div>
</template>
