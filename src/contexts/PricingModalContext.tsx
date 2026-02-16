'use client';

import { PricingModal } from '@/components/PricingModal';
import { PricingModalSource } from '@/types/pricing';
import React, { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface PricingModalContextType {
  openModal: (source: PricingModalSource, isClosable?: boolean) => void;
}

const PricingModalContext = createContext<PricingModalContextType | undefined>(undefined);

export const usePricingModal = () => {
  const context = useContext(PricingModalContext);
  if (!context) {
    throw new Error('usePricingModal must be used within a PricingModalProvider');
  }
  return context;
};

export const PricingModalProvider = ({ children }: { children: ReactNode }) => {
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isPricingModalClosable, setIsPricingModalClosable] = useState(true);
  const [modalSource, setModalSource] = useState<PricingModalSource | undefined>();

  const openModal = useCallback((source: PricingModalSource, isClosable = true) => {
    setModalSource(source);
    setIsPricingModalOpen(true);
    setIsPricingModalClosable(isClosable);
  }, []);

  const closeModal = useCallback(() => {
    setIsPricingModalOpen(false);
  }, []);

  const value = { openModal };

  return (
    <PricingModalContext.Provider value={value}>
      {children}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={closeModal}
        isClosable={isPricingModalClosable}
        source={modalSource}
      />
    </PricingModalContext.Provider>
  );
};
