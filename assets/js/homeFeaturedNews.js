(() => {
  'use strict';

  const section = document.querySelector('[data-home-featured-news]');
  const story = document.querySelector('[data-home-featured-news-story]');

  if (!section || !story) return;

  const escapeHTML = (value = '') =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const waitForVCLData = (methodName, timeout = 8000) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const check = () => {
        if (window.VCLData?.[methodName]) {
          resolve(window.VCLData);
          return;
        }

        if (Date.now() - startedAt > timeout) {
          reject(new Error(`VCLData.${methodName} blev ikke klar i tide.`));
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    });

  const cleanPreviewText = (value) =>
    String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/(?:discord\.gg|discord\.com\/invite)\/\S+/gi, ' ')
      .replace(/^\s*[-#>*]+\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();

  const getPreview = (post) => {
    const excerpt = cleanPreviewText(post.excerpt);
    const body = cleanPreviewText(post.body);
    const source = excerpt.length >= 35 ? excerpt : body || excerpt;

    if (!source) return 'Læs den seneste vigtige opdatering fra VCL.';
    if (source.length <= 240) return source;

    const shortened = source.slice(0, 240);
    const lastSpace = shortened.lastIndexOf(' ');
    const preview = lastSpace > 180 ? shortened.slice(0, lastSpace) : shortened;
    return `${preview.trim()}…`;
  };

  const getLink = (post) => {
    const slug = String(post.slug || '').trim();
    return slug ? `nyhed.html?slug=${encodeURIComponent(slug)}` : 'nyheder.html';
  };

  const formatDate = (value) => {
    if (!value) return 'VCL';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'VCL';

    return date.toLocaleDateString('da-DK', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const render = (post) => {
    const date = post.published_at || post.created_at || '';
    const link = getLink(post);

    story.innerHTML = `
      <div class="news-featured-story-v2__meta">
        <span>${escapeHTML(post.category || 'VCL News')}</span>
        <time datetime="${escapeHTML(date)}">${escapeHTML(formatDate(date))}</time>
        <b>${post.is_pinned ? 'Featured' : 'Seneste'}</b>
      </div>

      <div class="news-featured-story-v2__content">
        <h2><a href="${escapeHTML(link)}">${escapeHTML(post.title || 'VCL nyhed')}</a></h2>
        <p>${escapeHTML(getPreview(post))}</p>
        <a class="news-read-more-v2" href="${escapeHTML(link)}">
          Læs historien <span aria-hidden="true">→</span>
        </a>
      </div>
    `;

    story.removeAttribute('aria-busy');
    section.hidden = false;
  };

  const loadFeaturedNews = async () => {
    try {
      const VCLData = await waitForVCLData('getNewsPosts');
      const posts = await VCLData.getNewsPosts();

      if (!Array.isArray(posts) || !posts.length) {
        section.hidden = true;
        return;
      }

      const featuredPost = posts.find((post) => post.is_pinned) || posts[0];
      render(featuredPost);
    } catch (error) {
      console.warn('Homepage featured news kunne ikke indlæses:', error);
      section.hidden = true;
    }
  };

  loadFeaturedNews();
})();
