import"./c-QF3KKJLW.js";import"./c-33CL5ZQ6.js";import"./c-46FBBRP5.js";import"./c-AFGKFHDQ.js";import"./c-XEUMI45N.js";import"./c-73E3UOYM.js";import"./c-Q6BB5SL6.js";import{b as c,c as m,g as a,q as p}from"./c-MNEIUHSG.js";import"./c-SKTRKSW4.js";import"./c-Q2YJWIM5.js";import"./c-WOCWMBK5.js";import"./c-U4T7ICF3.js";import"./c-AXAIFJH2.js";import"./c-LK2HMISZ.js";import"./c-LI5ZJWUF.js";var w=c`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var u=function(o,e,i,r){var l=arguments.length,t=l<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(o,e,i,r);else for(var f=o.length-1;f>=0;f--)(n=o[f])&&(t=(l<3?n(t):l>3?n(e,i,t):n(e,i))||t);return l>3&&t&&Object.defineProperty(e,i,t),t},s=class extends a{render(){return m`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};s.styles=w;s=u([p("w3m-transactions-view")],s);export{s as W3mTransactionsView};
