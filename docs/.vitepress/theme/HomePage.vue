<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import ArrowIcon from './ArrowIcon.vue';
import RequestTrace from './RequestTrace.vue';
import { exampleConfig, guideEntries, homeCopy, type Locale } from './home-copy';

const { lang } = useData();
const locale = computed<Locale>(() => (lang.value === 'en-US' ? 'en' : 'zh'));
const copy = computed(() => homeCopy[locale.value]);
const repository = 'https://github.com/ben-lau/resource-fallback';
const home = ref<HTMLElement>();
let observer: IntersectionObserver | undefined;

function docsLink(path: string) {
  const prefix = locale.value === 'en' ? '/en' : '';
  return withBase(prefix + path);
}

onMounted(() => {
  if (!home.value || !('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver((entries, observer) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.add('rf-arrived');
      observer.unobserve(target);
    }
  });
  for (const element of home.value.querySelectorAll('[data-arrive]')) {
    observer.observe(element);
  }
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="home" class="rf-home" :lang="lang">
    <main>
      <section class="rf-wrap rf-hero" aria-labelledby="rf-title">
        <div class="rf-intro">
          <h1 id="rf-title" data-arrive>{{ copy.title }}</h1>
          <p data-arrive>{{ copy.summary }}</p>
          <div class="rf-hero-actions" data-arrive>
            <a class="rf-action" :href="docsLink('/guide/quick-start')">
              {{ copy.start }} <ArrowIcon />
            </a>
            <a class="rf-text-action" href="#rf-case">{{ copy.explain }}</a>
          </div>
        </div>
        <RequestTrace
          :locale="locale"
          :guide-link="docsLink('/guide/troubleshooting')"
          data-arrive
        />
      </section>

      <section id="rf-case" class="rf-wrap rf-case" aria-labelledby="rf-case-title">
        <div class="rf-case-copy">
          <h2 id="rf-case-title" data-arrive>{{ copy.caseTitle }}</h2>
          <p data-arrive>{{ copy.caseBody }}</p>
          <a
            class="rf-text-action"
            :href="docsLink('/guide/quick-start#read-the-replay')"
            data-arrive
          >
            {{ copy.caseLink }} <ArrowIcon />
          </a>
        </div>
        <figure class="rf-code-sample" data-ui data-arrive>
          <figcaption><code>vite.config.ts</code></figcaption>
          <pre><code>{{ exampleConfig }}</code></pre>
        </figure>
      </section>

      <section class="rf-wrap rf-directory" aria-labelledby="rf-directory-title">
        <h2 id="rf-directory-title" data-arrive>{{ copy.directory }}</h2>
        <div class="rf-directory-list">
          <div v-for="entry in guideEntries[locale]" :key="entry.title" class="rf-guide-entry">
            <h3 data-arrive>{{ entry.title }}</h3>
            <p data-arrive>{{ entry.body }}</p>
            <ul data-arrive>
              <li v-for="link in entry.links" :key="link.path">
                <a :href="docsLink(link.path)">{{ link.label }} <ArrowIcon /></a>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>

    <footer class="rf-footer" data-arrive>
      <div class="rf-wrap">
        <p class="rf-footer-mark">
          <img :src="withBase('/logo.svg')" alt="" width="34" height="34" />
          <span>Resource Fallback</span>
        </p>
        <ul>
          <li><a :href="repository">GitHub</a></li>
          <li><a :href="repository + '/actions/workflows/ci.yml'">CI</a></li>
          <li>
            <a href="https://codecov.io/gh/ben-lau/resource-fallback">{{ copy.coverage }}</a>
          </li>
          <li>
            <a :href="repository + '/blob/main/LICENSE'">{{ copy.license }}</a>
          </li>
          <li><a href="https://www.npmjs.com/package/@resource-fallback/core">npm</a></li>
        </ul>
      </div>
    </footer>
  </div>
</template>

<style scoped src="./home.css"></style>
