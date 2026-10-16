# clips/<name>/ (screencast frames + times.json) -> seq/<name>/0001.jpg... at a steady 30 fps
# usage: python3 clips2seq.py [name ...]   (no names = every clip). Prints each clip's frame count for SEQ in stage.html.
import json,os,subprocess,sys
names=sys.argv[1:] or sorted(os.listdir('clips'))
for n in names:
    d=f'clips/{n}';t=json.load(open(d+'/times.json'));L=[]
    for i in range(len(t)):
        L.append(f"file '{i:05d}.jpg'\nduration {max(0.001,(t[i+1]-t[i]) if i+1<len(t) else 0.04):.4f}")
    L.append(f"file '{len(t)-1:05d}.jpg'");open(d+'/list.txt','w').write('\n'.join(L))
    os.makedirs(f'seq/{n}',exist_ok=True)
    for f in os.listdir(f'seq/{n}'):os.remove(f'seq/{n}/{f}')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i',d+'/list.txt','-vf','fps=30','-q:v','3',f'seq/{n}/%04d.jpg'],check=True)
    print(n,len(os.listdir(f'seq/{n}')))
