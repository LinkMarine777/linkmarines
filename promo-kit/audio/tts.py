import asyncio,ssl,sys,json,edge_tts,edge_tts.communicate as C
C._SSL_CTX=ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
async def say(text,out,voice='en-AU-NatashaNeural',rate='+0%',pitch='+0Hz'):
    await edge_tts.Communicate(text,voice,rate=rate,pitch=pitch).save(out)
if __name__=='__main__':
    a=sys.argv;asyncio.run(say(a[1],a[2],*(a[3:])))
