import {
  CodeBlock,
  ImageSkeleton,
  MyCustomA,
  MyCustomBlockquote,
  MyCustomDel,
  MyCustomH1,
  MyCustomH2,
  MyCustomH3,
  MyCustomH4,
  MyCustomH5,
  MyCustomH6,
  MyCustomHr,
  MyCustomImg,
  MyCustomLi,
  MyCustomOl,
  MyCustomParagraph,
  MyCustomSub,
  MyCustomSup,
  MyCustomTable,
  MyCustomTbody,
  MyCustomTd,
  MyCustomTh,
  MyCustomThead,
  MyCustomTr,
  MyCustomUl,
  renderStandardInlineCode,
} from '@/components/MessageRenderDesign/MarkdownComponents';
import { ImageModal } from '@/components/ui/ImageModal';
import { downloadFile } from '@/lib/downloadFile';
import { truncateFileName } from '@/lib/stringUtils';
import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { FaFilePdf } from 'react-icons/fa';
import { FiCheck, FiChevronDown, FiChevronUp, FiCopy, FiDownload, FiPaperclip, FiRefreshCw } from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export const RenderedMessageItem: React.FC<{
  message: ChatMessageFromServer;
  isStreaming: boolean;
  onRetry?: (message: ChatMessageFromServer) => void;
  isLastFailedMessage?: boolean;
  showTypingIndicator?: boolean;
  thoughtText?: string;
  hasMinHeight?: boolean;
  dynamicMinHeight?: number;
}> = React.memo(
  ({
    message,
    isStreaming,
    onRetry,
    isLastFailedMessage,
    showTypingIndicator,
    thoughtText,
    hasMinHeight,
    dynamicMinHeight,
  }) => {
    const [isCopied, setIsCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showExpandButton, setShowExpandButton] = useState(false);
    const [showOrchestrating, setShowOrchestrating] = useState(false);
    const [imageModalOpen, setImageModalOpen] = useState(false);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const isUser = message.content_type === 'user';
    const bgColor = isUser ? 'bg-primary' : 'bg-card';
    const textColor = isUser ? 'text-background' : 'text-primary';

    // Handle progressive typing indicator
    useEffect(() => {
      if (showTypingIndicator && !isUser) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        if (message.try_number && message.try_number > 1) {
          setShowOrchestrating(true);
        } else {
          setShowOrchestrating(false);
          timerRef.current = setTimeout(() => {
            setShowOrchestrating(true);
          }, 1000);
        }
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setShowOrchestrating(false);
      }
    }, [
      showTypingIndicator,
      isUser,
      message.try_number,
    ]);

    useEffect(() => {
      const element = contentRef.current;
      if (isUser && element && !isExpanded) {
        const checkOverflow = () => {
          const isClamped = element.scrollHeight > element.clientHeight;
          if (showExpandButton !== isClamped) {
            setShowExpandButton(isClamped);
          }
        };
        const resizeObserver = new ResizeObserver(checkOverflow);
        resizeObserver.observe(element);
        checkOverflow();

        return () => resizeObserver.disconnect();
      }
    }, [
      isUser,
      isExpanded,
      showExpandButton,
    ]);

    if (message.content_type === 'system') {
      return (
        <div className="text-center my-2">
          <p className="text-xs text-primary/60 italic px-4 py-1 bg-primary/5 rounded-full inline-block">
            {message.content}
          </p>
        </div>
      );
    }

    const handleCopyToClipboard = () => {
      if (!message.content) return;
      navigator.clipboard
        .writeText(message.content)
        .then(() => {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        })
        .catch((err) => {
          console.error('Failed to copy text: ', err);
        });
    };

    const handleRetry = () => {
      if (onRetry) {
        onRetry(message);
      }
    };

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full mb-3 group`}>
        <div
          style={hasMinHeight && !isUser ? { minHeight: `${dynamicMinHeight || 500}px` } : undefined}
          className={`flex flex-col md:pr-1 ${
            message.attachments && message.attachments.length > 0 ? 'w-[85%] md:w-[55%]' : 'max-w-[99%] md:max-w-[99%]'
          }`}
        >
          <div
            className={`px-4 py-4 shadow-sm relative ${bgColor} ${textColor} after:content-[''] after:absolute after:w-0 after:h-0 after:border-solid after:top-0 ${
              isUser
                ? `rounded-l-lg rounded-br-lg after:right-0 after:border-t-[6px] after:border-l-[6px] after:border-l-transparent after:border-t-primary`
                : `rounded-r-lg rounded-bl-lg after:left-0 after:border-t-[6px] after:border-r-[6px] after:border-r-transparent after:border-t-card`
            }`}
          >
            {/* Show text message first - only if there's content OR if it's a failed assistant message */}
            {(message.content || (message.content_type === 'assistant' && message.failed)) && (
              <>
                {message.content_type === 'user' ? (
                  <div
                    ref={contentRef}
                    className={`font-sans text-[15px] ${textColor} ${!isExpanded ? 'max-h-[34vh] overflow-hidden' : ''} whitespace-pre-wrap`}
                  >
                    {message.content}
                  </div>
                ) : message.content_type === 'assistant' ? (
                  message.failed && message.failedMessage ? (
                    <div className="text-red-500 font-medium text-[15px]">{message.failedMessage}</div>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        p: MyCustomParagraph,
                        h1: MyCustomH1,
                        h2: MyCustomH2,
                        h3: MyCustomH3,
                        h4: MyCustomH4,
                        h5: MyCustomH5,
                        h6: MyCustomH6,
                        blockquote: MyCustomBlockquote,
                        ul: MyCustomUl,
                        ol: MyCustomOl,
                        li: MyCustomLi,
                        table: MyCustomTable,
                        thead: MyCustomThead,
                        tbody: MyCustomTbody,
                        tr: MyCustomTr,
                        th: MyCustomTh,
                        td: MyCustomTd,
                        hr: MyCustomHr,
                        a: MyCustomA,
                        img: MyCustomImg,
                        del: MyCustomDel,
                        sub: MyCustomSub,
                        sup: MyCustomSup,
                        code(
                          props: React.ComponentPropsWithoutRef<'code'> & {
                            inline?: boolean;
                            node?: unknown;
                            children?: React.ReactNode;
                          },
                        ) {
                          const { inline, className, children: markdownChildren, node, ...restProps } = props;

                          if (inline === true) {
                            return renderStandardInlineCode({
                              className,
                              children: markdownChildren,
                              node,
                            });
                          } else {
                            const match = /language-(\w+)/.exec(className || '');
                            const lang = match ? match[1] : '';
                            const isMultiLine = String(markdownChildren || '').includes('\n');

                            if (lang || isMultiLine) {
                              return (
                                <CodeBlock
                                  language={lang}
                                  code={String(markdownChildren || '').replace(/\n$/, '')}
                                  {...restProps}
                                />
                              );
                            } else {
                              return renderStandardInlineCode({
                                className,
                                children: markdownChildren,
                                node,
                              });
                            }
                          }
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )
                ) : (
                  <MyCustomParagraph>{message.content}</MyCustomParagraph>
                )}
              </>
            )}

            {/* Show attachments below text */}
            {message.attachments && message.attachments.length > 0 && (
              <div className={message.content ? 'mt-3' : ''}>
                {/* Separate images and documents */}
                {(() => {
                  const images = message.attachments.filter((att) => att.type === 'image');
                  const documents = message.attachments.filter((att) => att.type !== 'image');

                  return (
                    <>
                      {/* Images - 2 per row, but handle single image properly */}
                      {images.length > 0 && (
                        <div className={`grid gap-2 mb-3 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                          {images.map((att, index) => (
                            <div key={`image-${index}`} className="relative">
                              {att.url ? (
                                <div
                                  onClick={() => {
                                    setCurrentImageUrl(att.url || '');
                                    setImageModalOpen(true);
                                  }}
                                  className="block rounded-lg overflow-hidden border border-primary/20 shadow-sm text-center cursor-pointer"
                                >
                                  <Image
                                    src={att.url}
                                    alt={att.name || 'Attached image'}
                                    width={200}
                                    height={200}
                                    className="w-full h-auto object-contain rounded-md"
                                    loading="lazy"
                                    sizes="(max-width: 768px) 100vw, 200px"
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-red-400/50 bg-red-50/50">
                                  <div className="text-center">
                                    <FiPaperclip size={24} className="text-red-500 mx-auto mb-1" />
                                    <p className="text-xs text-red-500">Error loading image</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Documents - one per row */}
                      {documents.length > 0 && (
                        <div className="space-y-2">
                          {documents.map((att, index) => (
                            <div key={`doc-${index}`} className="relative">
                              {att.type === 'pdf' && att.url ? (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center p-2.5 rounded-lg border border-primary/20 bg-gray-100 hover:bg-gray-200 transition-colors"
                                >
                                  <FaFilePdf size={28} className="text-red-500 mr-2.5 flex-shrink-0" />
                                  <div className="flex-1 overflow-hidden">
                                    <p className="text-sm text-primary font-medium truncate" title={att.name}>
                                      {truncateFileName(att.name || 'document.pdf', 25)}
                                    </p>
                                    {att.size && <p className="text-xs text-primary/60">PDF Document</p>}
                                  </div>
                                </a>
                              ) : att.url ? (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center p-2.5 rounded-lg border border-primary/20 bg-gray-100 hover:bg-gray-200 transition-colors"
                                >
                                  <FiPaperclip size={24} className="text-primary/70 mr-2.5 flex-shrink-0" />
                                  <p className="text-sm text-primary font-medium truncate" title={att.name}>
                                    {truncateFileName(att.name || 'attachment', 25)}
                                  </p>
                                </a>
                              ) : (
                                <div className="flex items-center p-2.5 rounded-lg border border-dashed border-red-400/50 bg-red-50/50">
                                  <FiPaperclip size={24} className="text-red-500 mr-2.5 flex-shrink-0" />
                                  <div className="flex-1 overflow-hidden">
                                    <p className="text-sm text-red-700 font-medium truncate" title={att.name}>
                                      {truncateFileName(att.name || 'Attachment error', 25)}
                                    </p>
                                    <p className="text-xs text-red-500">
                                      {att.type === 'error' ? 'Error loading attachment' : 'Cannot display attachment'}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Show typing indicator inside assistant message when showTypingIndicator is true */}
            {showTypingIndicator && !isUser && !message.isGeneratingImage && (
              <div className="flex items-center space-x-2">
                {thoughtText ? (
                  // When thought text is available, show it with dots
                  <span className="text-primary text-[15px] whitespace-nowrap">
                    {thoughtText.split('\n')[0].replace(/\*\*/g, '')}
                  </span>
                ) : showOrchestrating ? (
                  <span className="text-primary text-[15px] whitespace-nowrap">Orchestrating</span>
                ) : null}
                {/* Always show dots when typing indicator is active */}
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"></div>
                </div>
              </div>
            )}

            {/* Show image skeleton when generating image */}
            {message.isGeneratingImage && (
              <div className="mt-3">
                {/* <div className="text-primary text-[15px] mb-2">Generating image</div> */}
                <ImageSkeleton />
              </div>
            )}

            {isStreaming && message.content && !message.isGeneratingImage && (
              <div className="flex items-center space-x-1 mt-2">
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"></div>
              </div>
            )}

            {/* Footer for Timestamp and Copy Icon - Only render when not showing typing indicator */}
            {!showTypingIndicator && (
              <div className="mt-1.5 flex items-center justify-between pt-1">
                <div className="flex items-center space-x-1 pr-1">
                  {!isUser && message.content && (
                    <button
                      onClick={handleCopyToClipboard}
                      className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                      title={isCopied ? 'Copied!' : 'Copy text'}
                    >
                      {isCopied ? (
                        <FiCheck size={14} className="text-primary" />
                      ) : (
                        <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
                      )}
                    </button>
                  )}
                  {!isUser &&
                    message.attachments &&
                    message.attachments.some((att) => att.type === 'image' || att.type === 'pdf') && (
                      <button
                        onClick={() => {
                          const firstAttachment = message.attachments?.find(
                            (att) => att.type === 'image' || att.type === 'pdf',
                          );
                          if (firstAttachment?.url) {
                            downloadFile(firstAttachment.url);
                          }
                        }}
                        className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                        title="Download attachment"
                      >
                        <FiDownload size={14} className="text-primary/60 hover:text-primary/80" />
                      </button>
                    )}
                  {isUser && message.failed && isLastFailedMessage && (
                    <button
                      onClick={handleRetry}
                      className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                      title="Retry sending"
                    >
                      <FiRefreshCw size={14} className="text-background/60 hover:text-background/90" />
                    </button>
                  )}
                  {isUser && showExpandButton && !isExpanded && (
                    <button
                      onClick={() => setIsExpanded(true)}
                      className="p-0.5 rounded text-xs text-background/60 hover:text-background/90 transition-colors focus:outline-none cursor-pointer "
                      title="Show more"
                    >
                      <FiChevronDown size={16} />
                    </button>
                  )}
                  {isUser && isExpanded && (
                    <button
                      onClick={() => setIsExpanded(false)}
                      className="p-0.5 rounded text-xs text-background/60 hover:text-background/90 transition-colors focus:outline-none cursor-pointer"
                      title="Show less"
                    >
                      <FiChevronUp size={16} />
                    </button>
                  )}
                </div>

                <p className={`text-xs whitespace-nowrap ${isUser ? 'text-background/60' : 'text-primary/60'}`}>
                  {(() => {
                    // For user messages, always show timestamp
                    if (isUser) {
                      const timestamp = message.timestamp;
                      if (!timestamp) return '';

                      try {
                        const match = timestamp.match(/(\d{2}):(\d{2}):/);
                        if (match) {
                          const hours = parseInt(match[1], 10);
                          const minutes = match[2];
                          const ampm = hours >= 12 ? 'PM' : 'AM';
                          const formattedHours = hours % 12 || 12;
                          return `${formattedHours}:${minutes} ${ampm}`;
                        }
                        return '';
                      } catch {
                        return '';
                      }
                    }

                    // For assistant messages - hide timestamp only if currently generating
                    if (message.content_type === 'assistant' && isStreaming) {
                      return '';
                    }

                    // Show timestamp for all other messages
                    const timestamp = message.timestamp;
                    if (!timestamp) return '';

                    try {
                      const match = timestamp.match(/(\d{2}):(\d{2}):/);
                      if (match) {
                        const hours = parseInt(match[1], 10);
                        const minutes = match[2];
                        const ampm = hours >= 12 ? 'PM' : 'AM';
                        const formattedHours = hours % 12 || 12;
                        return `${formattedHours}:${minutes} ${ampm}`;
                      }
                      return '';
                    } catch {
                      return '';
                    }
                  })()}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Image modal for fullscreen viewing */}
        {imageModalOpen && (
          <ImageModal isOpen={imageModalOpen} onClose={() => setImageModalOpen(false)} imageUrl={currentImageUrl} />
        )}
      </div>
    );
  },
);
RenderedMessageItem.displayName = 'RenderedMessageItem';
