<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import RequestTrace from './RequestTrace.vue';
import { guideGroups, homeCopy, recoverySteps, type Locale } from './home-copy';

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
      <section class="rf-hero" aria-labelledby="rf-title">
        <svg class="rf-route" viewBox="0 0 1040 690" preserveAspectRatio="none" aria-hidden="true">
          <path
            d="M1040 71H540a72 72 0 0 0-72 72v352a72 72 0 0 1-72 72H59"
            fill="none"
            stroke="currentColor"
            stroke-width="47"
          />
          <path d="m0 567 82-60v120z" fill="currentColor" />
        </svg>

        <div class="rf-wrap rf-hero-grid">
          <div class="rf-hero-copy">
            <h1 id="rf-title">{{ copy.title[0] }}<br />{{ copy.title[1] }}</h1>
            <p>{{ copy.summary }}</p>
            <a class="rf-action" :href="docsLink('/guide/quick-start')">
              {{ copy.start }}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path d="M3 12h17m-7-7 7 7-7 7" stroke="currentColor" stroke-width="2" />
              </svg>
            </a>
          </div>
          <RequestTrace :locale="locale" :guide-link="docsLink('/guide/troubleshooting')" />
        </div>
      </section>

      <section class="rf-wrap rf-process" aria-labelledby="rf-process-title">
        <div class="rf-section-intro" data-arrive>
          <h2 id="rf-process-title">{{ copy.process }}</h2>
          <p>{{ copy.processIntro }}</p>
        </div>
        <ol class="rf-steps">
          <li
            v-for="step in recoverySteps"
            :key="step.kind"
            class="rf-step"
            :data-stage="step.kind"
            data-arrive
          >
            <h3>{{ step[locale].title }}</h3>
            <figure class="rf-sample" data-ui>
              <figcaption>
                <code>{{ step.symbol }}</code>
              </figcaption>
              <dl>
                <div v-for="field in step.fields" :key="field.name">
                  <dt>
                    <code>{{ field.name }}</code>
                  </dt>
                  <dd>
                    <code>{{ field.value }}<wbr v-if="field.path" />{{ field.path }}</code>
                  </dd>
                </div>
              </dl>
            </figure>
            <p>{{ step[locale].body }}</p>
          </li>
        </ol>
      </section>

      <section class="rf-wrap rf-directory" aria-labelledby="rf-directory-title">
        <div class="rf-section-intro" data-arrive>
          <h2 id="rf-directory-title">{{ copy.directory }}</h2>
          <p>{{ copy.directoryIntro }}</p>
        </div>
        <div v-for="group in guideGroups" :key="group.label.en" class="rf-guide-group" data-arrive>
          <h3>{{ group.label[locale] }}</h3>
          <ul>
            <li v-for="guide in group.links" :key="guide.path">
              <a :href="docsLink(guide.path)">
                <strong>{{ guide[locale].title }}</strong>
                <span>{{ guide[locale].body }}</span>
              </a>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <footer class="rf-footer" data-arrive>
      <div class="rf-wrap">
        <p class="rf-footer-mark">
          <img :src="withBase('/logo.svg')" alt="" width="72" height="72" />
          <span>Resource Fallback</span>
        </p>
        <div class="rf-footer-links">
          <ul>
            <li><a :href="repository">GitHub</a></li>
            <li><a :href="repository + '/actions/workflows/ci.yml'">CI</a></li>
            <li>
              <a href="https://codecov.io/gh/ben-lau/resource-fallback">{{ copy.coverage }}</a>
            </li>
            <li>
              <a :href="repository + '/blob/main/LICENSE'">{{ copy.license }}</a>
            </li>
          </ul>
          <ul aria-label="npm">
            <li><a href="https://www.npmjs.com/package/@resource-fallback/core">Core</a></li>
            <li>
              <a href="https://www.npmjs.com/package/@resource-fallback/vite-plugin">Vite plugin</a>
            </li>
            <li>
              <a href="https://www.npmjs.com/package/@resource-fallback/webpack-plugin"
                >Webpack plugin</a
              >
            </li>
          </ul>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped src="./home.css"></style>
