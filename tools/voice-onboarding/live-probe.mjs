// Synthetic audio round trip; requires explicit authorized staging credentials.
// Does not create accounts, save profiles, touch OAuth or test human microphone quality.
import { writeFile } from 'node:fs/promises';
import { provider } from './openrouter.mjs';
if (process.env.VOICE_EXPERIMENT_SPEND_APPROVED !== 'true') throw Error('Configure an approved capped staging key before running.');
const timings=[];
const voice=provider({key:process.env.OPENROUTER_API_KEY,stt:process.env.ONBOARDING_STT_MODEL,llm:process.env.ONBOARDING_LLM_MODEL,tts:process.env.ONBOARDING_TTS_MODEL,voice:process.env.ONBOARDING_TTS_VOICE});
async function time(label,fn){const start=performance.now();const result=await fn();timings.push({operation:label,milliseconds:Math.round(performance.now()-start)});return result;}
const generated=await time('synthetic_input_tts',()=>voice.speak('My preferred name is Test Asha.'));
const transcript=await time('stt',()=>voice.transcribe(generated.toString('base64'),'mp3'));
const value=await time('extract_name',()=>voice.extract('name',transcript));
await time('response_tts',()=>voice.speak('Lovely to meet you. What fills most of your day?'));
const results={synthetic:true,liveProvider:true,extractedValue:value,timings,loopMilliseconds:timings.filter(x=>x.operation!=='synthetic_input_tts').reduce((sum,x)=>sum+x.milliseconds,0),humanMicrophone:'NOT_TESTED',oauth:'NOT_TESTED',persistence:'NOT_TESTED',cost:'Reconcile the four requests in OpenRouter activity; no assumed price.'};
await writeFile('verification/voice-onboarding/live-probe-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
