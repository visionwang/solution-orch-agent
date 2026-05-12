<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { DraftArtifact, ProjectRecord } from '../shared/types';
import {
  createProject,
  docxExportUrl,
  getProject,
  listProjects,
  runProject,
  updateDraft,
  uploadDocument,
  type ProjectDetail
} from './api';

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

  await withBusy(async () => {
    await runProject(activeProjectId.value);
    await refreshProjects();
    await openProject(activeProjectId.value);
  }, '流程已完成');
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

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
}
</script>

<template>
  <main class="shell">
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
          <button :disabled="!activeProjectId || busy" @click="runWorkflow">运行流程</button>
          <a v-if="activeProjectId" class="button ghost" :href="docxExportUrl(activeProjectId)" download>导出 DOCX</a>
        </div>
      </header>

      <p v-if="message" class="notice">{{ message }}</p>

      <div v-if="detail" class="grid">
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
      </div>

      <section v-else class="empty">
        <h2>暂无项目</h2>
        <p>创建项目后上传需求文件和产品资料，再运行端到端生成流程。</p>
      </section>
    </section>
  </main>
</template>

