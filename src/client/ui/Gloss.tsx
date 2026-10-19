import type { ComponentChildren } from 'preact';
import { define, GLOSS_RE, GLOSSARY } from '../glossary';
import { isMobile, showToast } from '../store';

/** An acronym/jargon term with its definition on hover (desktop) or tap (touch). */
export function Abbr({ term, children }: { term: string; children?: ComponentChildren }) {
  const def = define(term);
  if (!def) return <>{children ?? term}</>;
  return (
    <abbr
      title={def}
      tabIndex={0}
      onClick={(e) => {
        if (isMobile.value || matchMedia('(pointer: coarse)').matches) {
          e.stopPropagation();
          showToast(`${term} — ${def}`);
        }
      }}
    >
      {children ?? term}
    </abbr>
  );
}

/** Renders text, wrapping the first occurrence of each glossary term in an <Abbr>. */
export function Gloss({ text }: { text: string }) {
  const out: ComponentChildren[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const m of text.matchAll(GLOSS_RE)) {
    const term = m[0];
    const key = term.length > 3 && term[0] === term[0].toUpperCase() && term.slice(1) === term.slice(1).toLowerCase() ? term.toLowerCase() : term;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.slice(last, m.index));
    out.push(<Abbr key={m.index} term={key}>{term}</Abbr>);
    last = m.index! + term.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

export function GlossaryList() {
  return (
    <dl class="glossary">
      {Object.entries(GLOSSARY).map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
