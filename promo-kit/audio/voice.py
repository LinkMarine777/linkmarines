# every line of vo.json -> ft_<key>.wav (Australian voice, silence trimmed); prints each line's length to set scene durations
import json,asyncio,subprocess
from tts import say
L=json.load(open('vo.json'))
async def main():
    for k,t in L: await say(t,f'f_{k}.mp3','en-AU-NatashaNeural','+18%')
asyncio.run(main())
for k,_ in L:
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',f'f_{k}.mp3','-af','silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse','-ar','44100','-ac','1',f'ft_{k}.wav'])
    d=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'ft_{k}.wav'],capture_output=True,text=True).stdout.strip()
    print(k,round(float(d),2))
