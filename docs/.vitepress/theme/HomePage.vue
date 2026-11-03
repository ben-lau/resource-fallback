<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import RequestTrace from './RequestTrace.vue';
import { homeCopy, readingRoutes, type Locale } from './home-copy';

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
        <div class="rf-wrap">
          <h1 id="rf-title" data-arrive>{{ copy.title }}</h1>
          <div class="rf-hero-lead">
            <p data-arrive>{{ copy.summary }}</p>
            <a class="rf-action" :href="docsLink('/guide/quick-start')" data-arrive>
              {{ copy.start }}
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M2 8h11m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.7" />
              </svg>
            </a>
          </div>
          <RequestTrace
            :locale="locale"
            :guide-link="docsLink('/guide/troubleshooting')"
            data-arrive
          />
        </div>
      </section>

      <section class="rf-wrap rf-reading" aria-labelledby="rf-reading-title">
        <h2 id="rf-reading-title" data-arrive>{{ copy.directory }}</h2>
        <ol class="rf-reading-list">
          <li v-for="route in readingRoutes" :key="route.file" class="rf-reading-row">
            <div class="rf-reading-copy">
              <h3 data-arrive>{{ route[locale].title }}</h3>
              <p data-arrive>{{ route[locale].body }}</p>
              <ul data-arrive>
                <li v-for="link in route[locale].links" :key="link.path">
                  <a :href="docsLink(link.path)">
                    {{ link.label }}
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                      <path d="M2 8h11m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.7" />
                    </svg>
                  </a>
                </li>
              </ul>
            </div>
            <figure class="rf-code-sample" data-ui data-arrive>
              <figcaption>
                <code>{{ route.file }}</code>
              </figcaption>
              <pre><code>{{ route.code }}</code></pre>
            </figure>
          </li>
        </ol>
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
