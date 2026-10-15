import"./c-VGE65UBG.js";import"./c-OQIXY2LC.js";import"./c-QKJIG5P6.js";import"./c-AFGKFHDQ.js";import"./c-WLOQ2TEW.js";import"./c-SOGNHUHP.js";import"./c-4KZ22Y5P.js";import{b as c,c as m,g as a,q as p}from"./c-2HXULR2Z.js";import"./c-4QTFSQWI.js";import"./c-LVRTF2GU.js";import"./c-TAG7KP4N.js";import"./c-U4T7ICF3.js";import"./c-X245OCVC.js";import"./c-LK2HMISZ.js";import"./c-UOZWMSI3.js";var w=c`
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
