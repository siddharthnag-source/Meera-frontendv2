'use client';

import hljs from 'highlight.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import 'highlight.js/styles/atom-one-light.css';

// Props that react-markdown passes to custom components
interface ReactMarkdownProps {
  node?: any;
  children?: React.ReactNode;
  level?: number;
  ordered?: boolean;
  checked?: boolean | null;
  [key: string]: any;
}

// Combine with standard HTML attributes for the specific element type
type CustomComponentProps<T extends HTMLElement> = React.HTMLAttributes<T> & ReactMarkdownProps;

// Shared copy functionality hook
const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return { copied, copyText };
};

// Helper function to extract text from React children
const extractTextFromChildren = (element: any): string => {
  if (typeof element === 'string') return element;
  if (typeof element === 'number') return String(element);
  if (!element) return '';

  if (element.props && element.props.children) {
    if (Array.isArray(element.props.children)) {
      return element.props.children.map(extractTextFromChildren).join('');
    }
    return extractTextFromChildren(element.props.children);
  }

  if (Array.isArray(element)) {
    return element.map(extractTextFromChildren).join('');
  }
  return '';
};

// CodeBlock component with copy functionality
interface CodeBlockProps {
  language: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const { copied, copyText } = useCopyToClipboard();
  const displayLanguage = language ? language.charAt(0).toUpperCase() + language.slice(1) : '';

  const highlightedCode = useMemo(() => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return '';
    try {
      const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
      return hljs.highlight(trimmedCode, { language: validLanguage, ignoreIllegals: true }).value;
    } catch (e) {
      console.error('Error highlighting code:', e);
      return trimmedCode; // Fallback to un-highlighted code
    }
  }, [code, language]);

  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-gray-50">
      <div className="px-3 py-1.5 flex justify-between items-center bg-gray-100 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700">{displayLanguage}</span>
        <button
          onClick={() => copyText(code)}
          className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <FiCheck size={14} className="text-primary" />
          ) : (
            <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
          )}
        </button>
      </div>
      <pre className="text-[15px] font-sans overflow-x-auto whitespace-pre-wrap break-words">
        <code
          className={`language-${language || 'plaintext'} hljs`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
};

// Helper function for rendering standard inline code elements
export const renderStandardInlineCode = (
  inlineProps: React.ComponentPropsWithoutRef<'code'> & {
    node?: unknown;
  },
) => {
  const { className, children, ...htmlElementProps } = inlineProps;
  const codeContent = String(children || '');
  const urlRegex = /^(https?:\/\/|www\.)\S+/i;

  if (urlRegex.test(codeContent)) {
    const href = codeContent.startsWith('www.') ? `http://${codeContent}` : codeContent;
    return (
      <code
        {...htmlElementProps}
        className={`${className || ''} bg-primary/10 text-primary p-0.5 rounded-sm [font-family:inherit] [font-size:inherit]`}
      >
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
          {children}
        </a>
      </code>
    );
  }

  return (
    <code
      {...htmlElementProps}
      className={`${className || ''} bg-primary/10 text-primary p-0.5 rounded-sm [font-family:inherit] [font-size:inherit]`}
    >
      {children}
    </code>
  );
};

// Paragraph component (fallback for any other content or response)
export const MyCustomParagraph: React.FC<CustomComponentProps<HTMLParagraphElement>> = ({
  children,
  node,
  ...rest
}) => (
  <p className="text-[15px] font-sans leading-relaxed mt-2" {...rest}>
    {children}
  </p>
);

// Heading components
export const MyCustomH1: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h1 className="text-2xl font-sans font-semibold pt-4 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h1>
);

export const MyCustomH2: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h2 className="text-xl font-sans font-semibold pt-4 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h2>
);

export const MyCustomH3: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h3 className="text-lg font-sans font-semibold pt-2 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h3>
);

export const MyCustomH4: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h4 className="text-base font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h4>
);

export const MyCustomH5: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h5 className="text-sm font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h5>
);

export const MyCustomH6: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h6 className="text-xs font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h6>
);

// Blockquote component with copy functionality
export const MyCustomBlockquote: React.FC<CustomComponentProps<HTMLQuoteElement>> = ({ children, node, ...rest }) => {
  const { copied, copyText } = useCopyToClipboard();

  const handleCopy = () => {
    const text = extractTextFromChildren(children);
    copyText(text);
  };

  return (
    <div className="my-4">
      <blockquote
        className="border-l-4 font-sans border-primary pl-4 italic bg-primary/10 p-4 pb-2 rounded-md text-[15px] relative"
        {...rest}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1 pr-6">{children}</div>
          <button
            onClick={handleCopy}
            className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10 flex-shrink-0"
            title={copied ? 'Copied!' : 'Copy quote'}
          >
            {copied ? (
              <FiCheck size={14} className="text-primary" />
            ) : (
              <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
            )}
          </button>
        </div>
      </blockquote>
    </div>
  );
};

// List components
export const MyCustomUl: React.FC<CustomComponentProps<HTMLUListElement>> = ({ children, node, ...rest }) => (
  <ul className="list-disc font-sans pl-6 space-y-1 my-2 text-[15px]" {...rest}>
    {children}
  </ul>
);

export const MyCustomOl: React.FC<CustomComponentProps<HTMLOListElement>> = ({ children, node, ordered, ...rest }) => (
  <ol className="list-decimal font-sans pl-6 space-y-1 my-4 text-[15px]" {...rest}>
    {children}
  </ol>
);

export const MyCustomLi: React.FC<CustomComponentProps<HTMLLIElement>> = ({ children, node, ...rest }) => (
  <li className="font-sans text-[15px]" {...rest}>
    {children}
  </li>
);

// Other inline elements
export const MyCustomHr: React.FC<CustomComponentProps<HTMLHRElement>> = ({ node, ...rest }) =>
  // do not render line breaks
  null;
// <hr className="my-4 border-gray-300" {...rest} />

export const MyCustomA: React.FC<CustomComponentProps<HTMLAnchorElement>> = ({ children, node, href, ...rest }) => (
  <a
    href={href}
    className="font-sans text-primary underline hover:no-underline focus:outline-none focus:ring-1 focus:ring-primary-focus"
    target="_blank"
    rel="noopener noreferrer"
    {...rest}
  >
    {children}
  </a>
);

export const MyCustomImg: React.FC<CustomComponentProps<HTMLImageElement>> = ({ node, src, alt, ...rest }) => (
  <div className="block my-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md">
    <img
      src={src}
      alt={src}
      className="rounded-md border border-gray-200 shadow-sm font-sans w-full h-auto object-contain"
      {...rest}
    />
  </div>
);

export const MyCustomDel: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <del className="font-sans text-[15px]" {...rest}>
    {children}
  </del>
);

export const MyCustomSub: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <sub className="font-sans align-baseline text-[0.75em] leading-none" {...rest}>
    {children}
  </sub>
);

export const MyCustomSup: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <sup className="font-sans align-baseline text-[0.75em] leading-none" {...rest}>
    {children}
  </sup>
);

// Table components with copy functionality
export const MyCustomTable: React.FC<CustomComponentProps<HTMLTableElement>> = ({ children, node, ...rest }) => {
  const { copied, copyText } = useCopyToClipboard();
  const tableRef = useRef<HTMLTableElement>(null);

  const handleCopy = () => {
    if (!tableRef.current) return;
    const tableText = Array.from(tableRef.current.rows)
      .map((row) =>
        Array.from(row.cells)
          .map((cell) => cell.innerText)
          .join('\t'),
      )
      .join('\n');
    copyText(tableText);
  };

  return (
    <div className="mb-4 font-sans text-[15px]">
      <div className="flex justify-end">
        <button
          onClick={handleCopy}
          className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10"
          title={copied ? 'Copied!' : 'Copy table'}
        >
          {copied ? (
            <FiCheck size={14} className="text-primary" />
          ) : (
            <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-primary scrollbar-track-gray-200 hover:scrollbar-thumb-primary/80 scrollbar-thumb-rounded-md">
        <table ref={tableRef} className="min-w-full divide-y divide-gray-300 border border-gray-300" {...rest}>
          {children}
        </table>
      </div>
    </div>
  );
};

export const MyCustomThead: React.FC<CustomComponentProps<HTMLTableSectionElement>> = ({ children, node, ...rest }) => (
  <thead className="bg-gray-50" {...rest}>
    {children}
  </thead>
);

export const MyCustomTbody: React.FC<CustomComponentProps<HTMLTableSectionElement>> = ({ children, node, ...rest }) => (
  <tbody className="divide-y divide-gray-200 bg-white" {...rest}>
    {children}
  </tbody>
);

export const MyCustomTr: React.FC<CustomComponentProps<HTMLTableRowElement>> = ({ children, node, ...rest }) => (
  <tr className="hover:bg-gray-50" {...rest}>
    {children}
  </tr>
);

export const MyCustomTh: React.FC<CustomComponentProps<HTMLTableCellElement> & { isNumeric?: boolean }> = ({
  children,
  node,
  isNumeric,
  ...rest
}) => (
  <th
    scope="col"
    className={`px-4 py-3 text-left text-sm font-sans font-semibold text-gray-900 ${
      isNumeric ? 'text-right' : ''
    } last:pr-12`}
    {...rest}
  >
    {children}
  </th>
);

export const MyCustomTd: React.FC<CustomComponentProps<HTMLTableCellElement> & { isNumeric?: boolean }> = ({
  children,
  node,
  isNumeric,
  ...rest
}) => {
  const processedChildren = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.split(/<br\s*\/?>/i);
      if (parts.length > 1) {
        return parts.map((part, index) => (
          <React.Fragment key={index}>
            {part}
            {index < parts.length - 1 && <br />}
          </React.Fragment>
        ));
      }
    }
    return child;
  });

  return (
    <td
      className={`whitespace-normal align-top font-sans px-4 py-2 text-[15px] text-gray-700 ${
        isNumeric ? 'text-right' : ''
      }`}
      {...rest}
    >
      {processedChildren}
    </td>
  );
};

// Image Skeleton component for showing loading state during image generation
export const ImageSkeleton: React.FC = () => {
  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-gray-50">
      <div className="h-76 w-76 sm:h-136 sm:w-136 md:h-95 md:w-95 bg-gray-200 rounded-md flex items-center justify-center">
        {/* Primary color loader in the center */}
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>
  );
};
