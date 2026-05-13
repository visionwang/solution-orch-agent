<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { DraftArtifact, ProjectRecord } from '../shared/types';
import {
  chatStream,
  clearAuth,
  createProject,
  docxExportUrl,
  getEvaluations,
  getProject,
  getStoredUser,
  listProjects,
  runProject,
  runProjectStream,
  updateDraft,
  updateEvaluation,
  uploadDocument,
  type AuthUser,
  type EvaluationItem,
  type ProjectDetail,
  type StepStatus,
  type StepInfo,
} from './api';
import LoginView from './Login.vue';

const currentUser = ref<AuthUser | null>(getStoredUser());

function onLogin(user: AuthUser) {
  currentUser.value = user;
}

function logout() {
  clearAuth();
  currentUser.value = null;
  projects.value = [];
  detail.value = null;
}

const projects = ref<ProjectRecord[]>([]);
const activeProjectId = ref('');
const detail = ref<ProjectDetail | null>(null);
const newProjectName = ref('智慧园区投标项目');
const uploadKind = ref<'requirement' | 'product' | 'reference'>('requirement');
const selectedFile = ref<File | null>(null);
const activeDraftId = ref('');
const draftContent = ref('');
const busy = ref(false);
const message = ref('');

const steps = ref<StepInfo[]>([]);
const stepStatuses = ref<Record<string, StepStatus>>({});
const closeStream = ref<(() => void) | null>(null);

const chatMessages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
const chatInput = ref('');
const chatLoading = ref(false);
const chatOpen = ref(false);
const cancelChat = ref<(() => void) | null>(null);

const evalEnabled = ref(false);
const evaluations = ref<EvaluationItem[]>([]);
const evalEditingId = ref('');
const evalScoreInput = ref(0);
const evalNotesInput = ref('');

const evalByCategory = computed(() => {
  const groups: Record<string, EvaluationItem[]> = {};
  for (const e of evaluations.value) {
    if (!groups[e.category]) groups[e.category] = [];
    groups[e.category].push(e);
  }
  return groups;
});

const activeProject = computed(() => detail.value?.project ?? null);
const activeDraft = computed(() => detail.value?.drafts.find((item) => item.id === activeDraftId.value) ?? null);
const coverage = computed(() => {
  const matches = detail.value?.matches ?? [];
  if (!matches.length) return 0;
  return Math.round((matches.filter((item) => item.status === 'matched').length / matches.length) * 100);
});

onMounted(async () => {
  await refreshProjects();
});

async function refreshProjects() {
  projects.value = await listProjects();
  if (!activeProjectId.value && projects.value[0]) {
    await openProject(projects.value[0].id);
  }
}

async function addProject() {
  await withBusy(async () => {
    const project = await createProject(newProjectName.value);
    projects.value.unshift(project);
    await openProject(project.id);
  }, '项目已创建');
}

async function openProject(projectId: string) {
  activeProjectId.value = projectId;
  detail.value = await getProject(projectId);
  const draft = detail.value.drafts[0];
  activeDraftId.value = draft?.id ?? '';
  draftContent.value = draft?.content ?? '';
}

async function submitUpload() {
  if (!selectedFile.value || !activeProjectId.value) return;

  await withBusy(async () => {
    await uploadDocument(activeProjectId.value, uploadKind.value, selectedFile.value as File);
    selectedFile.value = null;
    await openProject(activeProjectId.value);
  }, '文档已上传并解析');
}

async function runWorkflow() {
  if (!activeProjectId.value) return;

  busy.value = true;
  message.value = '';
  steps.value = [];
  stepStatuses.value = {};
  closeStream.value = runProjectStream(activeProjectId.value, {
    onSteps: (s) => { steps.value = s; },
    onProgress: (stepId, status) => {
      stepStatuses.value[stepId] = status;
    },
    onComplete: async () => {
      await refreshProjects();
      await openProject(activeProjectId.value);
      message.value = '流程已完成';
      busy.value = false;
    },
    onError: (error) => {
      message.value = error;
      busy.value = false;
    },
  });
}

async function saveDraft() {
  if (!activeProjectId.value || !activeDraftId.value) return;

  await withBusy(async () => {
    await updateDraft(activeProjectId.value, activeDraftId.value, draftContent.value);
    await openProject(activeProjectId.value);
  }, '草稿已保存');
}

function selectDraft(draft: DraftArtifact) {
  activeDraftId.value = draft.id;
  draftContent.value = draft.content;
}

async function withBusy(action: () => Promise<void>, success: string) {
  busy.value = true;
  message.value = '';
  try {
    await action();
    message.value = success;
  } catch (error) {
    message.value = error instanceof Error ? error.message : '操作失败';
  } finally {
    busy.value = false;
  }
}

function sendChatMessage() {
  if (!chatInput.value.trim() || !activeProjectId.value) return;

  const userMessage = chatInput.value.trim();
  chatInput.value = '';
  chatMessages.value.push({ role: 'user', content: userMessage });
  chatLoading.value = true;

  const assistantIndex = chatMessages.value.length;
  chatMessages.value.push({ role: 'assistant', content: '' });

  cancelChat.value = chatStream(activeProjectId.value, userMessage, {
    onChunk: (chunk) => {
      chatMessages.value[assistantIndex].content += chunk;
    },
    onDone: () => {
      chatLoading.value = false;
      cancelChat.value = null;
    },
    onError: (error) => {
      chatMessages.value[assistantIndex].content = `错误：${error}`;
      chatLoading.value = false;
      cancelChat.value = null;
    },
  });
}

function toggleChat() {
  chatOpen.value = !chatOpen.value;
  if (!chatOpen.value && cancelChat.value) {
    cancelChat.value();
    cancelChat.value = null;
  }
}

async function loadEvaluations() {
  if (!activeProjectId.value) return;
  evaluations.value = await getEvaluations(activeProjectId.value);
}

async function submitEvalScore(item: EvaluationItem) {
  await updateEvaluation(item.id, evalScoreInput.value, evalNotesInput.value);
  evalEditingId.value = '';
  await loadEvaluations();
}

function startEditEval(item: EvaluationItem) {
  evalEditingId.value = item.id;
  evalScoreInput.value = item.score ?? 0;
  evalNotesInput.value = item.notes;
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
}
</script>

<template>
  <LoginView v-if="!currentUser" @login="onLogin" />
  <main v-else class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="mark">SO</span>
        <div>
          <h1>方案生成 Agent</h1>
          <p>需求到投标工作台</p>
        </div>
      </div>

      <form class="new-project" @submit.prevent="addProject">
        <input v-model="newProjectName" aria-label="项目名称" />
        <button :disabled="busy">新建</button>
      </form>

      <nav class="project-list" aria-label="项目列表">
        <button
          v-for="project in projects"
          :key="project.id"
          :class="{ active: project.id === activeProjectId }"
          @click="openProject(project.id)"
        >
          <span>{{ project.name }}</span>
          <small>{{ project.status }}</small>
        </button>
      </nav>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Mastra Workflow / Vue3</p>
          <h2>{{ activeProject?.name ?? '创建一个项目开始' }}</h2>
        </div>
        <div class="actions">
          <span class="user-chip" v-if="currentUser">{{ currentUser.displayName }} <button class="button ghost" @click="logout">退出</button></span>
          <label class="eval-toggle" title="开启后每次运行记录评估快照">
            <input type="checkbox" v-model="evalEnabled" /> 评估模式
          </label>
          <button :disabled="!activeProjectId || busy" @click="runWorkflow">运行流程</button>
          <button v-if="evalEnabled && activeProjectId" class="button ghost" :disabled="busy" @click="loadEvaluations">加载评估</button>
          <a v-if="activeProjectId" class="button ghost" :href="docxExportUrl(activeProjectId)" download>导出 DOCX</a>
        </div>
      </header>

      <p v-if="message" class="notice">{{ message }}</p>

      <div v-if="detail" class="grid">
        <section v-if="steps.length > 0" class="panel progress-panel">
          <div class="panel-head">
            <h3>执行进度</h3>
            <span>{{ busy ? '运行中' : '已完成' }}</span>
          </div>
          <div class="step-list">
            <div v-for="step in steps" :key="step.stepId" :class="['step-item', stepStatuses[step.stepId] ?? 'pending']">
              <span class="step-icon">
                <template v-if="stepStatuses[step.stepId] === 'success'">✓</template>
                <template v-else-if="stepStatuses[step.stepId] === 'running'">◌</template>
                <template v-else-if="stepStatuses[step.stepId] === 'failed'">✕</template>
                <template v-else>○</template>
              </span>
              <span class="step-label">{{ step.label }}</span>
            </div>
          </div>
        </section>

        <section class="panel upload-panel">
          <div class="panel-head">
            <h3>文档输入</h3>
            <span>{{ detail.documents.length }} 份</span>
          </div>
          <form class="upload-form" @submit.prevent="submitUpload">
            <select v-model="uploadKind" aria-label="文档类型">
              <option value="requirement">需求/招标</option>
              <option value="product">产品资料</option>
              <option value="reference">参考模板</option>
            </select>
            <input type="file" accept=".txt,.md,.docx,.xlsx,.xls,.pdf" @change="onFileChange" />
            <button :disabled="!selectedFile || busy">上传</button>
          </form>
          <ul class="compact-list">
            <li v-for="document in detail.documents" :key="document.id">
              <span>{{ document.fileName }}</span>
              <small>{{ document.kind }}</small>
            </li>
          </ul>
        </section>

        <section class="panel metric-panel">
          <div class="metric">
            <strong>{{ detail.requirements.length }}</strong>
            <span>需求项</span>
          </div>
          <div class="metric">
            <strong>{{ coverage }}%</strong>
            <span>完全匹配</span>
          </div>
          <div class="metric">
            <strong>{{ detail.reviewFindings.length }}</strong>
            <span>审核意见</span>
          </div>
        </section>

        <section class="panel requirements">
          <div class="panel-head">
            <h3>需求清单</h3>
            <span>抽取结果</span>
          </div>
          <div class="table">
            <div v-for="item in detail.requirements" :key="item.id" class="row">
              <b>{{ item.title }}</b>
              <span>{{ item.priority }}</span>
              <p>{{ item.description }}</p>
            </div>
          </div>
        </section>

        <section class="panel matches">
          <div class="panel-head">
            <h3>产品匹配</h3>
            <span>证据驱动</span>
          </div>
          <div class="table">
            <div v-for="match in detail.matches" :key="match.id" class="row">
              <b>{{ match.status }} · {{ Math.round(match.score * 100) }}%</b>
              <p>{{ match.rationale }}</p>
              <small>{{ match.evidence[0] ?? '暂无证据' }}</small>
            </div>
          </div>
        </section>

        <section class="panel editor">
          <div class="panel-head">
            <h3>草稿编辑</h3>
            <div class="tabs">
              <button
                v-for="draft in detail.drafts"
                :key="draft.id"
                :class="{ active: draft.id === activeDraftId }"
                @click="selectDraft(draft)"
              >
                {{ draft.type === 'solution' ? '解决方案' : '投标材料' }}
              </button>
            </div>
          </div>
          <textarea v-model="draftContent" :placeholder="activeDraft ? '' : '运行流程后生成草稿'" />
          <button :disabled="!activeDraftId || busy" @click="saveDraft">保存草稿</button>
        </section>

        <section class="panel review">
          <div class="panel-head">
            <h3>AI 审核意见</h3>
            <span>风险与遗漏</span>
          </div>
          <article v-for="finding in detail.reviewFindings" :key="finding.id" :class="['finding', finding.severity]">
            <strong>{{ finding.title }}</strong>
            <p>{{ finding.detail }}</p>
          </article>
        </section>

        <section v-if="Object.keys(evalByCategory).length > 0" class="panel eval-panel">
          <div class="panel-head">
            <h3>评估记录</h3>
            <span>{{ evaluations.length }} 条</span>
          </div>
          <div v-for="(items, category) in evalByCategory" :key="category" class="eval-category">
            <h4>{{ category }}</h4>
            <div v-for="item in items" :key="item.id" class="eval-row">
              <span class="eval-mode" :class="item.mode">{{ item.mode }}</span>
              <span class="eval-score" v-if="item.score !== null">{{ item.score }}分</span>
              <span class="eval-score none" v-else>未评分</span>
              <span class="eval-notes" v-if="item.notes">{{ item.notes }}</span>
              <button class="button ghost" @click="startEditEval(item)" v-if="evalEditingId !== item.id">评分</button>
              <div v-if="evalEditingId === item.id" class="eval-edit">
                <input type="number" v-model="evalScoreInput" min="0" max="100" placeholder="评分 0-100" />
                <input v-model="evalNotesInput" placeholder="备注" />
                <button @click="submitEvalScore(item)">保存</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section v-else class="empty">
        <h2>暂无项目</h2>
        <p>创建项目后上传需求文件和产品资料，再运行端到端生成流程。</p>
      </section>
    </section>

      <!-- Chat button -->
      <button class="chat-toggle" @click="toggleChat" :title="chatOpen ? '关闭对话' : '打开对话'">
        {{ chatOpen ? '✕' : '💬' }}
      </button>

      <!-- Chat panel -->
      <aside v-if="chatOpen" class="chat-panel">
        <div class="chat-head">
          <h3>方案助手</h3>
          <small>{{ activeProject?.name }}</small>
        </div>
        <div class="chat-messages">
          <div v-for="(msg, idx) in chatMessages" :key="idx" :class="['chat-msg', msg.role]">
            <div class="msg-content">{{ msg.content }}</div>
          </div>
          <p v-if="chatLoading && chatMessages[chatMessages.length - 1]?.content === ''" class="chat-typing">思考中...</p>
          <p v-if="chatMessages.length === 0" class="chat-empty">询问关于当前方案的问题，例如「哪些需求没有覆盖到？」</p>
        </div>
        <form class="chat-input" @submit.prevent="sendChatMessage">
          <input v-model="chatInput" placeholder="输入问题..." :disabled="chatLoading" />
          <button :disabled="!chatInput.trim() || chatLoading">发送</button>
        </form>
      </aside>
  </main>
</template>

