# voice lines placed at their scenes + music ducked under the voice -> mix.wav (-15 LUFS, social level)
# usage: python3 mix.py 5.6,6.0,4.9,...   (the scene durations, same order as vo.json and the ND list in stage.html)
import json,subprocess,sys
keys=[k for k,_ in json.load(open('vo.json'))];durs=[float(x) for x in sys.argv[1].split(',')]
assert len(keys)==len(durs),'one duration per voice line'
starts=[];a=0
for d in durs: starts.append(a);a+=d
off={keys[0]:0.7,keys[-1]:0.6}   # the line starts this long into its scene (default 0.35 s)
inputs=[];filt=[]
for i,k in enumerate(keys):
    inputs+=['-i',f'ft_{k}.wav'];ms=int((starts[i]+off.get(k,0.35))*1000);filt.append(f'[{i}]adelay={ms}|{ms}[v{i}]')
filt.append(''.join(f'[v{i}]' for i in range(len(keys)))+f'amix=inputs={len(keys)}:normalize=0,highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=1.6[vo]')
subprocess.run(['ffmpeg','-loglevel','error','-y',*inputs,'-filter_complex',';'.join(filt),'-map','[vo]','-ar','44100','-ac','2','vo_track.wav'],check=True)
subprocess.run(['ffmpeg','-loglevel','error','-y','-i','music.wav','-i','vo_track.wav','-filter_complex',
 '[0]volume=0.55[m];[1]asplit[v][sc];[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md];[md][v]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=11[o]',
 '-map','[o]','-ar','48000','mix.wav'],check=True)
for i,k in enumerate(keys):
    d=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'ft_{k}.wav'],capture_output=True,text=True).stdout)
    if starts[i]+off.get(k,0.35)+d>starts[i]+durs[i]: print('OVERRUN',k,'- make its scene longer')
print('mix.wav',round(a,1),'s')
