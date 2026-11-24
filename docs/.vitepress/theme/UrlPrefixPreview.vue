<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useData } from 'vitepress';
import { previewPrefixes } from './url-preview';

const { lang } = useData();
const english = computed(() => lang.value === 'en-US');
const pageUrl = ref('https://app.example.com/app/');
const resourceUrl = ref('https://cdn1.example.com/app/assets/app.js');
const base = ref('https://cdn1.example.com/app/');
const candidates = ref('https://cdn2.example.com/app/\n/app/');
const retries = ref(1);
const rulesJson = ref('');
const interactive = ref(false);
const error = ref('');
const result = ref(calculate());
const copy = computed(() =>
  english.value
    ? {
        page: 'Page URL',
        resource: 'Initial asset URL',
        base: 'Rule base',
        candidates: 'Fallback prefixes, one per line',
        retries: 'Retries per URL',
        advanced: 'Multiple rules (optional JSON)',
        json: 'Rules array',
        jsonHelp: 'When supplied, this array replaces the base and fallback fields above.',
        run: 'Preview URLs',
        reset: 'Reset example',
        matched: 'Matched prefix',
        suffix: 'Retained path',
        chain: 'Candidate URLs',
        initial: 'Initial URL',
        candidate: 'Fallback',
        missing: 'No matching rule. Check the initial URL and rule base.',
        invalid: 'Check your input:',
        budget: 'Maximum attempts with no open circuits or deadlines:',
        note: 'This preview calculates URLs. Verify availability, CSP, CORS, and actual requests in your production build.',
      }
    : {
        page: '页面地址',
        resource: '首次资源 URL',
        base: '规则 base',
        candidates: '回退前缀，每行一个',
        retries: '每个 URL 的重试次数',
        advanced: '多条规则（可选 JSON）',
        json: '规则数组',
        jsonHelp: '填写后以此数组替代上方的 base 和回退前缀。',
        run: '预览请求地址',
        reset: '重置示例',
        matched: '命中的前缀',
        suffix: '保留的路径',
        chain: '候选请求地址',
        initial: '首次请求',
        candidate: '回退',
        missing: '没有匹配的规则，请核对首次资源 URL 与规则 base。',
        invalid: '请检查输入：',
        budget: '无熔断且未触发超时时，最多尝试：',
        note: '这里计算最终 URL。资源可用性、CSP、CORS 和实际请求请在生产构建中验证。',
      },
);

function calculate() {
  return previewPrefixes({
    pageUrl: pageUrl.value.trim(),
    resourceUrl: resourceUrl.value.trim(),
    retries: retries.value,
    rules: rulesJson.value.trim()
      ? JSON.parse(rulesJson.value)
      : [
          {
            base: base.value.trim(),
            urls: candidates.value
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          },
        ],
  });
}

function preview() {
  error.value = '';
  try {
    result.value = calculate();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function reset() {
  pageUrl.value = 'https://app.example.com/app/';
  resourceUrl.value = 'https://cdn1.example.com/app/assets/app.js';
  base.value = 'https://cdn1.example.com/app/';
  candidates.value = 'https://cdn2.example.com/app/\n/app/';
  retries.value = 1;
  rulesJson.value = '';
  preview();
}

onMounted(() => {
  interactive.value = true;
});
</script>

<template>
  <section class="rf-tool" :aria-label="english ? 'URL prefix preview' : 'URL 前缀预览'" data-ui>
    <form @submit.prevent="preview">
      <fieldset :disabled="!interactive" class="rf-tool-fields">
        <legend class="rf-tool-legend">{{ english ? 'Deployment inputs' : '发布地址输入' }}</legend>
        <label
          >{{ copy.page }}<input v-model="pageUrl" type="url" required spellcheck="false"
        /></label>
        <label
          >{{ copy.resource }}<input v-model="resourceUrl" required spellcheck="false"
        /></label>
        <label
          >{{ copy.base
          }}<input v-model="base" :disabled="!!rulesJson.trim()" required spellcheck="false"
        /></label>
        <label
          >{{ copy.retries
          }}<input v-model.number="retries" type="number" min="0" step="1" required
        /></label>
        <label class="rf-tool-wide"
          >{{ copy.candidates
          }}<textarea
            v-model="candidates"
            :disabled="!!rulesJson.trim()"
            rows="3"
            required
            spellcheck="false"
          />
        </label>
        <details class="rf-tool-wide">
          <summary>{{ copy.advanced }}</summary>
          <label
            >{{ copy.json
            }}<textarea
              v-model="rulesJson"
              rows="5"
              spellcheck="false"
              aria-describedby="rules-json-help"
            />
          </label>
          <p id="rules-json-help" class="rf-tool-help">{{ copy.jsonHelp }}</p>
        </details>
        <div class="rf-tool-actions rf-tool-wide">
          <button type="submit" class="rf-tool-primary">{{ copy.run }}</button>
          <button type="button" @click="reset">{{ copy.reset }}</button>
        </div>
      </fieldset>
    </form>
    <div v-if="error" role="alert" class="rf-tool-error">{{ copy.invalid }} {{ error }}</div>
    <div v-else class="rf-tool-result" aria-live="polite">
      <template v-if="result.matched">
        <dl class="rf-tool-facts">
          <div>
            <dt>{{ copy.matched }}</dt>
            <dd>
              <code>{{ result.base }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ copy.suffix }}</dt>
            <dd>
              <code>{{ result.suffix || '/' }}</code>
            </dd>
          </div>
        </dl>
        <ol class="rf-url-chain" :aria-label="copy.chain">
          <li v-for="(entry, index) in result.chain" :key="index">
            <span>{{ index === 0 ? copy.initial : `${copy.candidate} ${index}` }}</span>
            <code>{{ entry.url }}</code>
          </li>
        </ol>
        <p>
          {{ copy.budget }} <strong>{{ result.maximumAttempts }}</strong>
        </p>
      </template>
      <p v-else>{{ copy.missing }}</p>
    </div>
    <p class="rf-tool-help">{{ copy.note }}</p>
    <noscript>{{
      english ? 'Enable JavaScript to edit this example.' : '启用 JavaScript 后可修改此示例。'
    }}</noscript>
  </section>
</template>
