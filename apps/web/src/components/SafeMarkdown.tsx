import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { safeUrl } from "@/lib/safeUrl";

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeUrl(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = safeUrl(src);
    if (!safe) return null;
    return <img src={safe} alt={alt ?? ""} />;
  },
  blockquote: ({ children }) => (
    <aside className="my-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm leading-6">
      {children}
    </aside>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  hr: () => <hr className="my-6 border-current/20" />,
  h1: ({ children }) => <h1 className="mt-6 font-display text-xl font-semibold tracking-tight sm:text-2xl">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 font-display text-lg font-semibold tracking-tight sm:text-xl">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 text-base font-semibold">{children}</h3>,
};

export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={
        className ??
        "prose-beacon max-w-none overflow-x-auto text-[15px] leading-7 text-ink [&_blockquote]:border-0 [&_blockquote]:p-0 [&_code]:font-mono [&_code]:text-[13px] [&_li]:my-1 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-[#0d1117] [&_pre]:p-4 [&_table]:my-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={safeUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
