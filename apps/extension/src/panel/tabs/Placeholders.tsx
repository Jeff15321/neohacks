import React from 'react';
import { Empty } from '../components/ui/primitives.js';

/** Tab shells owned by later phases. Each phase replaces its export with a file of its own (tabs/<Name>.tsx). */
export const RecordTab = () => <Empty>Record a workflow once, then turn it into a widget. (Phase B)</Empty>;
export const ActivityTab = () => <Empty>What the assistant thinks you're doing, patterns and suggestions. (Phase D)</Empty>;
export const DataTab = () => <Empty>Data your widgets saved (collections and documents). (Phase A)</Empty>;
