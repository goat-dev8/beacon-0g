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
};

export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={
        className ??
        "prose-beacon max-w-none overflow-x-auto text-[15px] leading-7 text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-signal/50 [&_blockquote]:pl-4 [&_blockquote]:text-ink-muted [&_code]:font-mono [&_code]:text-[13px] [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold sm:[&_h1]:text-2xl [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold sm:[&_h2]:text-xl [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-1 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-[#0d1117] [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5"
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
