/** Server explanations and untrusted plain-text highlighting. */
import { describe, expect, it } from 'vitest';
import { highlightSearchText, presentSearchSnippet } from './search-result.js';

describe('search result presentation', function describePresentation() {
  it('uses a custom substrate field and server matched fields verbatim', function presentsCustomMatch() {
    const snippet = presentSearchSnippet({ item: { id: 'NOTE-0001', title: 'No title match' }, type: 'note', score: 1, snippet: { field: 'decision_basis', text: 'The needle is here', matched_fields: ['decision_basis', 'tags'] } }, 'needle');
    expect(snippet.field).toBe('decision_basis');
    expect(snippet.matchedFields).toEqual(['decision_basis', 'tags']);
    expect(snippet.html).toContain('<mark class="spotlight-match">needle</mark>');
  });

  it('renders source and query HTML as text with only client-owned marks', function escapesMarkup() {
    const html = highlightSearchText('<img src=x onerror=alert(1)> needle & more', '<img needle');
    const span = document.createElement('span');
    span.innerHTML = html;
    expect(span.querySelector('img')).toBeNull();
    expect(span.textContent).toBe('<img src=x onerror=alert(1)> needle & more');
    expect(span.querySelectorAll('mark')).toHaveLength(2);
    expect(highlightSearchText('<script>x</script>', '')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('uses an escaped title when an older server omits a snippet', function presentsFallback() {
    expect(presentSearchSnippet({ item: { id: 'TASK-0001', title: '<b>needle</b>' }, type: 'task', score: 1 }, 'needle').matchedFields).toEqual([]);
  });
});
