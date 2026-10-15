import{b as h,c as f,g as m,m as c,o,q as y,r as i}from"./c-2HXULR2Z.js";var x=h`
  :host {
    display: flex;
    width: inherit;
    height: inherit;
    box-sizing: border-box;
  }
`;var e=function(s,r,n,a){var l=arguments.length,p=l<3?r:a===null?a=Object.getOwnPropertyDescriptor(r,n):a,g;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")p=Reflect.decorate(s,r,n,a);else for(var d=s.length-1;d>=0;d--)(g=s[d])&&(p=(l<3?g(p):l>3?g(r,n,p):g(r,n))||p);return l>3&&p&&Object.defineProperty(r,n,p),p},t=class extends m{render(){return this.style.cssText=`
      flex-direction: ${this.flexDirection};
      flex-wrap: ${this.flexWrap};
      flex-basis: ${this.flexBasis};
      flex-grow: ${this.flexGrow};
      flex-shrink: ${this.flexShrink};
      align-items: ${this.alignItems};
      justify-content: ${this.justifyContent};
      column-gap: ${this.columnGap&&`var(--apkt-spacing-${this.columnGap})`};
      row-gap: ${this.rowGap&&`var(--apkt-spacing-${this.rowGap})`};
      gap: ${this.gap&&`var(--apkt-spacing-${this.gap})`};
      padding-top: ${this.padding&&o.getSpacingStyles(this.padding,0)};
      padding-right: ${this.padding&&o.getSpacingStyles(this.padding,1)};
      padding-bottom: ${this.padding&&o.getSpacingStyles(this.padding,2)};
      padding-left: ${this.padding&&o.getSpacingStyles(this.padding,3)};
      margin-top: ${this.margin&&o.getSpacingStyles(this.margin,0)};
      margin-right: ${this.margin&&o.getSpacingStyles(this.margin,1)};
      margin-bottom: ${this.margin&&o.getSpacingStyles(this.margin,2)};
      margin-left: ${this.margin&&o.getSpacingStyles(this.margin,3)};
      width: ${this.width};
    `,f`<slot></slot>`}};t.styles=[c,x];e([i()],t.prototype,"flexDirection",void 0);e([i()],t.prototype,"flexWrap",void 0);e([i()],t.prototype,"flexBasis",void 0);e([i()],t.prototype,"flexGrow",void 0);e([i()],t.prototype,"flexShrink",void 0);e([i()],t.prototype,"alignItems",void 0);e([i()],t.prototype,"justifyContent",void 0);e([i()],t.prototype,"columnGap",void 0);e([i()],t.prototype,"rowGap",void 0);e([i()],t.prototype,"gap",void 0);e([i()],t.prototype,"padding",void 0);e([i()],t.prototype,"margin",void 0);e([i()],t.prototype,"width",void 0);t=e([y("wui-flex")],t);
