import numpy as np,wave
SR=44100;TOTAL=90.0;BPM=120;BEAT=60/BPM;BAR=4*BEAT
N=int(SR*TOTAL);t=np.arange(N)/SR
rng=np.random.default_rng(7)
def mtof(m):return 440*2**((m-69)/12)
def lp(x,a):  # one-pole lowpass, a in (0,1): higher = brighter
    y=np.empty_like(x);acc=0.0
    for i in range(len(x)):acc+=a*(x[i]-acc);y[i]=acc
    return y
def saw(f,tt):return 2*((tt*f)%1)-1
def env(n,a,d,s,r,sus):  # samples
    e=np.zeros(n);A=int(a*SR);D=int(d*SR);R=int(r*SR);S=max(0,n-A-D-R)
    e[:A]=np.linspace(0,1,A,False) if A else 0
    e[A:A+D]=np.linspace(1,sus,D,False);e[A+D:A+D+S]=sus;e[A+D+S:A+D+S+R]=np.linspace(sus,0,min(R,n-(A+D+S)),False)[:len(e[A+D+S:A+D+S+R])]
    return e
out=np.zeros(N);pad=np.zeros(N);bass=np.zeros(N);drm=np.zeros(N);arp=np.zeros(N)
CH=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]  # Am F C G
DROP=16.0;OUT=83.0;FULL2=46.0
def put(buf,start,sig):
    i=int(start*SR);j=min(N,i+len(sig));buf[i:j]+=sig[:j-i]
nbars=int(TOTAL/BAR)+1
for b in range(nbars):
    t0=b*BAR;ch=CH[(b//2)%4]
    # pad: detuned saws, whole 2-bar chord on even bars
    if b%2==0:
        n=int(2*BAR*SR);tt=np.arange(n)/SR;s=np.zeros(n)
        for m in ch+[ch[0]+12]:
            f=mtof(m);s+=saw(f*1.003,tt)+saw(f*0.997,tt)
        s*=env(n,0.9,0.5,0.8,1.2,0.8)*0.05;put(pad,t0,s)
    # bass: 8ths on root (after 6s)
    if t0>=6 and t0<OUT:
        for k in range(8):
            st=t0+k*BEAT/2;n=int(BEAT/2*SR*0.9);tt=np.arange(n)/SR;f=mtof(ch[0]-24)
            s=(saw(f,tt)*0.6+np.sin(2*np.pi*f*tt))*env(n,0.004,0.12,0.5,0.05,0.5)*(0.16 if t0>=DROP else 0.09);put(bass,st,s)
    # drums
    for k in range(4):
        st=t0+k*BEAT
        if st>=DROP and st<OUT or (st>=10 and st<DROP and k%2==0):   # half-time kick before the drop
            n=int(0.35*SR);tt=np.arange(n)/SR;f=45+80*np.exp(-tt*30);ph=2*np.pi*np.cumsum(f)/SR
            put(drm,st,np.sin(ph)*np.exp(-tt*9)*0.55)
        if st>=DROP and st<OUT and k in (1,3):   # clap
            n=int(0.22*SR);tt=np.arange(n)/SR;nz=rng.standard_normal(n);nz=nz-lp(nz,0.25)
            put(drm,st,nz*np.exp(-tt*22)*0.16)
        if st>=6 and st<OUT:   # hats on the offbeat
            n=int(0.06*SR);tt=np.arange(n)/SR;nz=rng.standard_normal(n);nz=nz-lp(nz,0.6)
            put(drm,st+BEAT/2,nz*np.exp(-tt*60)*(0.07 if st>=DROP else 0.045))
    # arp: 16ths chord tones in the second half
    if t0>=FULL2 and t0<OUT:
        seq=[ch[0]+12,ch[1]+12,ch[2]+12,ch[1]+12]
        for k in range(16):
            st=t0+k*BEAT/4;m=seq[k%4];n=int(BEAT/4*SR);tt=np.arange(n)/SR;f=mtof(m)
            s=np.sign(np.sin(2*np.pi*f*tt))*0.5+saw(f*2,tt)*0.2;put(arp,st,s*np.exp(-tt*14)*0.035)
# riser into the drop
n=int(4*SR);tt=np.arange(n)/SR;nz=rng.standard_normal(n);put(out,DROP-4,(nz-lp(nz,0.3))*(tt/4)**2*0.12)
pad=lp(pad,0.08);bass=lp(bass,0.15);arp=lp(arp,0.35)
mix=out+pad+bass+drm+arp
# fade in / out
fi=int(1.5*SR);mix[:fi]*=np.linspace(0,1,fi);fo=int(6*SR);mix[-fo:]*=np.linspace(1,0,fo)
mix=np.tanh(mix*1.4)/np.tanh(1.4);mix/=np.max(np.abs(mix))*1.12
st=np.stack([mix,np.roll(mix,int(0.012*SR))*0.96],1)   # slight width
with wave.open('music.wav','wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((st*32767).astype(np.int16).tobytes())
print('ok',TOTAL)
