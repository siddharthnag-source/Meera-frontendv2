  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      tryNumber: number = 1,
      optimisticIdToUpdate?: string,
      isFromManualRetry: boolean = false,
    ) => {
      if (isSending) return;

      const trimmedMessage = messageText.trim();
      const hasText = trimmedMessage.length > 0;
      const hasAttachments = attachments.length > 0;

      if (!hasText && !hasAttachments) return;

      // STEP 1: upload all *user* attachments (files you attach manually) to Supabase Storage
      let uploaded: UploadedMeta[] = [];
      if (hasAttachments) {
        try {
          uploaded = await Promise.all(
            attachments.map((att) =>
              uploadAttachmentToStorage(att.file, att.type),
            ),
          );
        } catch (uploadErr) {
          console.error('Upload failed', uploadErr);
          showToast('Failed to upload file(s). Please try again.', {
            type: 'error',
            position: 'conversation',
          });
          return;
        }
      }

      // Attach storagePath/publicUrl back onto attachments for optimistic UI
      const attachmentsWithStorage: ChatAttachmentInputState[] = attachments.map(
        (att, index) => {
          const meta = uploaded[index];
          if (!meta) return att;
          return {
            ...att,
            storagePath: meta.storagePath,
            publicUrl: meta.publicUrl,
          };
        },
      );

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // STEP 2: create optimistic user + assistant placeholders
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(
          optimisticId,
          trimmedMessage,
          attachmentsWithStorage,
        );

        const assistantMessageId = `assistant-${Date.now()}`;
        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: assistantMessageId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
          try_number: tryNumber,
          failed: false,
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();

        setTimeout(() => scrollToBottom(true, true), 150);
      } else {
        // Retry: clear failed state on the user message
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.message_id === optimisticId
              ? { ...msg, failed: false, try_number: tryNumber }
              : msg,
          ),
        );
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;
      setIsAssistantTyping(true);

      // STEP 3: build a payload message that includes public URLs for *user* attachments
      let payloadMessage = trimmedMessage;

      if (uploaded.length > 0) {
        const attachmentsTextLines = uploaded.map(
          (meta) =>
            `- ${meta.name} (${meta.mimeType}, ${meta.size} bytes): ${meta.publicUrl}`,
        );

        payloadMessage = [
          trimmedMessage,
          '',
          'Attached files (public URLs, please open and read them):',
          ...attachmentsTextLines,
        ]
          .filter(Boolean)
          .join('\n');
      }

      const assistantId =
        messageRelationshipMapRef.current.get(optimisticId);

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: payloadMessage,
          // for now we always stream text; the Edge Function internally decides
          onDelta: (delta) => {
            fullAssistantText += delta;
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: (msg.content || '') + delta,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : msg,
              ),
            );
          },

          /**
           * NEW: when Gemini returns images (for "generate image ..." prompts),
           * we 1) upload them to Supabase Storage,
           * 2) update the assistant message's attachments in local state,
           * 3) persist those attachments into the `messages` table.
           */
          onImages: async (images: GeneratedImage[]) => {
            if (!assistantId || !images || images.length === 0) return;

            try {
              // Convert base64 images -> File -> upload to Storage
              const imageMetas: UploadedMeta[] = [];

              for (let i = 0; i < images.length; i++) {
                const img = images[i];

                const mime = img.mimeType || 'image/png';
                const base64 = img.data;

                // base64 -> Uint8Array
                const byteChars = atob(base64);
                const byteNumbers = new Array(byteChars.length);
                for (let j = 0; j < byteChars.length; j++) {
                  byteNumbers[j] = byteChars.charCodeAt(j);
                }
                const byteArray = new Uint8Array(byteNumbers);

                const blob = new Blob([byteArray], { type: mime });
                const fileName = `generated-${Date.now()}-${i}.png`;
                const file = new File([blob], fileName, { type: mime });

                const meta = await uploadAttachmentToStorage(file, 'image');
                imageMetas.push(meta);
              }

              // Build attachment objects that match what the UI expects
              const imageAttachments: ChatAttachmentFromServer[] = imageMetas.map(
                (meta, index) => ({
                  name: meta.name || `generated-image-${index + 1}.png`,
                  type: 'image',
                  url: meta.publicUrl,
                  size: meta.size,
                }),
              );

              // 2) Update local React state so the image shows instantly
              setChatMessages((prev) =>
                prev.map((msg) =>
                  msg.message_id === assistantId
                    ? {
                        ...msg,
                        attachments: [
                          ...(msg.attachments ?? []),
                          ...imageAttachments,
                        ],
                      }
                    : msg,
                ),
              );

              // 3) Persist attachments into `messages` table so they survive refresh
              try {
                await supabase
                  .from('messages')
                  .update({
                    attachments: imageAttachments,
                  })
                  .eq('message_id', assistantId);
              } catch (dbErr) {
                console.error(
                  'Failed to persist generated image attachments to messages table',
                  dbErr,
                );
              }
            } catch (e) {
              console.error('Error handling generated images', e);
            }
          },

          onDone: () => {
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: msg.content || fullAssistantText,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : msg,
              ),
            );
          },

          onError: (err) => {
            throw err;
          },
        });

        return;
      } catch (error) {
        console.error('Error sending message:', error);

        showToast('Failed to respond, try again', {
          type: 'error',
          position: 'conversation',
        });

        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id === optimisticId)
              return { ...msg, failed: true };
            if (assistantId && msg.message_id === assistantId) {
              return {
                ...msg,
                failed: true,
                failedMessage: 'Failed to respond, try again',
              };
            }
            return msg;
          }),
        );
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        lastOptimisticMessageIdRef.current = null;

        if (isFromManualRetry) {
          setTimeout(() => scrollToBottom(true, true), 150);
        }
      }
    },
    [
      isSending,
      createOptimisticMessage,
      setChatMessages,
      clearAllInput,
      scrollToBottom,
      setIsSending,
      setJustSentMessage,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      showToast,
      onMessageSent,
    ],
  );
