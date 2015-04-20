(function() {
  var Builder = function(parent) {
    if (parent) {
      this._parent = parent;
      this._indentLevel = parent._indentLevel;
    } else {
      this._buffer = '';
      this._indentLevel = 0;
    }
    this._methodSeparator = '';
    this._varIndex = {};
  };

  Canopy.extend(Builder.prototype, {
    serialize: function() {
      return this._buffer;
    },

    outputPathname: function(inputPathname) {
      return inputPathname.replace(/\.peg$/, '.rb');
    },

    _write: function(string) {
      if (this._parent) return this._parent._write(string);
      this._buffer += string;
    },

    _indent: function(block, context) {
      this._indentLevel += 1;
      block.call(context, this);
      this._indentLevel -= 1;
    },

    _newline: function() {
      this._write('\n');
      var i = this._indentLevel;
      while (i--) this._write('  ');
    },

    _line: function(source) {
      this._newline();
      this._write(source);
    },

    _quote: function(string) {
      string = string.replace(/\\/g, '\\\\')
                     .replace(/"/g, '\\"')
                     .replace(/\x07/g, '\\a')
                     .replace(/\x08/g, '\\b')
                     .replace(/\t/g, '\\t')
                     .replace(/\n/g, '\\n')
                     .replace(/\v/g, '\\v')
                     .replace(/\f/g, '\\f')
                     .replace(/\r/g, '\\r')
                     .replace(/\x1b/g, '\\e');

      return '"' + string + '"';
    },

    package_: function(name, block, context) {
      this._write('module ' + name.replace(/\./g, '::'));
      this._indent(block, context);
      this._line('end');
    },

    syntaxNodeClass_: function() {
      var name = 'SyntaxNode';
      this._line('class ' + name);
      this._indent(function(builder) {
        builder._line('include Enumerable');
        builder.attributes_(['text', 'offset', 'elements']);
        builder.method_('initialize', ['text', 'offset', 'elements'], function(builder) {
          builder.attribute_('text', 'text');
          builder.attribute_('offset', 'offset');
          builder.attribute_('elements', 'elements || []');
        });
        builder.method_('each', ['&block'], function(builder) {
          builder._line('@elements.each(&block)');
        });
      });
      this._line('end');
      this._newline();
      return name;
    },

    grammarModule_: function(block, context) {
      this.assign_('ParseError', 'Struct.new(:input, :offset, :expected)');
      this._newline();
      this._line('module Grammar');
      new Builder(this)._indent(block, context);
      this._line('end');
      this._newline();
    },

    parserClass_: function(root) {
      this._line('class Parser');
      this._indent(function(builder) {
        builder._line('include Grammar');
        builder._methodSeparator = '\n';

        builder.method_('initialize', ['input'], function(builder) {
          builder.attribute_('input', 'input');
          builder.attribute_('offset', '0');
          builder.attribute_('cache', 'Hash.new { |h,k| h[k] = {} }');
        });

        builder.method_('parse', [], function(builder) {
          builder.assign_('tree', '_read_' + root);
          builder.if_('tree and @offset == @input.size', function(builder) {
            builder.return_('tree');
          });
          builder._line('@error ||= ParseError.new(@input, @offset, "<EOF>")')
          builder._line('raise SyntaxError, Parser.format_error(@error)') // TODO format error
        });

        builder.method_('self.format_error', ['error'], function(builder) {
          builder._line('lines, line_no, offset = error.input.split(/\\n/), 0, 0');
          builder._line('while offset <= error.offset');
          builder._indent(function(builder) {
            builder._line('offset += lines[line_no].size + 1');
            builder._line('line_no += 1');
          });
          builder._line('end');
          builder._line('message, line = "Line #{line_no}: expected #{error.expected}\\n", lines[line_no - 1]');
          builder._line('message += "#{line}\\n"');
          builder._line('offset -= line.size + 1');
          builder._line('message += " " * (error.offset - offset)');
          builder.return_('message + "^"');
        });
      });
      this._line('end');
      this._newline();
    },

    exports_: function() {
      this._line('def self.parse(input)');
      this._indent(function(builder) {
        builder.assign_('parser', 'Parser.new(input)')
        builder._line('parser.parse')
      });
      this._line('end');
    },

    class_: function(name, parent, block, context) {
      this._line('class ' + name + ' < ' + parent);
      new Builder(this)._indent(block, context);
      this._line('end');
      this._newline();
    },

    constructor_: function(args, block, context) {
      this.method_('initialize', args, function(builder) {
        builder._line('super');
        block.call(context, builder);
      });
    },

    method_: function(name, args, block, context) {
      this._write(this._methodSeparator);
      this._methodSeparator = '\n';
      args = (args.length > 0) ? '(' + args.join(', ') + ')' : '';
      this._line('def ' + name + args);
      new Builder(this)._indent(block, context);
      this._line('end');
    },

    cache_: function(name, block, context) {
      var temp      = this.localVars_({address: this.null_(), index: '@offset'}),
          address   = temp.address,
          offset    = temp.index,
          cacheMap  = '@cache[:' + name + ']',
          cacheAddr = cacheMap + '[' + offset + ']';

      this.assign_('cached', cacheAddr);

      this.if_('cached', function(builder) {
        builder._line('@offset += cached.text.size');
        builder.return_('cached');
      }, this);

      block.call(context, this, address);
      this.return_(cacheAddr + ' = ' + address);
    },

    attributes_: function(names) {
      var keys = [];
      for (var i = 0, n = names.length; i < n; i++) keys.push(':' + names[i]);
      this._line('attr_reader ' + keys.join(', '));
      this._methodSeparator = '\n';
    },

    attribute_: function(name, value) {
      this.assign_('@' + name, value);
    },

    localVars_: function(vars) {
      var names = {}, lhs = [], rhs = [], varName;
      for (var name in vars) {
        this._varIndex[name] = this._varIndex[name] || 0;
        varName = name + this._varIndex[name];
        this._varIndex[name] += 1;
        lhs.push(varName);
        rhs.push(vars[name]);
        names[name] = varName;
      }
      this.assign_(lhs.join(', '), rhs.join(', '));
      return names;
    },

    localVar_: function(name, value) {
      this._varIndex[name] = this._varIndex[name] || 0;
      var varName = name + this._varIndex[name];
      this._varIndex[name] += 1;
      this.assign_(varName, (value === undefined) ? this.null_(): value);
      return varName;
    },

    chunk_: function(length) {
      var chunk = this.localVar_('chunk', this.null_()), input = '@input', of = '@offset';
      this.if_(input + '.size > ' + of, function(builder) {
        builder.assign_(chunk, input + '[' + of + '...(' + of + ' + ' + length + ')]');
      });
      return chunk;
    },

    syntaxNode_: function(address, nodeType, expression, bump, elements, nodeClass) {
      elements = ', ' + (elements || '[]');

      var klass = nodeClass || 'SyntaxNode',
          of    = ', @offset';

      this.assign_(address, klass + '.new(' + expression + of + elements + ')');
      this.extendNode_(address, nodeType);
      this._line('@offset += ' + bump);
    },

    extendNode_: function(address, nodeType) {
      if (!nodeType) return;
      this._line(address + '.extend(' + nodeType.replace(/\./g, '::') + ')');
    },

    failure_: function(address, expected) {
      this.assign_(address, this.null_());
      this.unless_('@error and @error.offset > @offset', function(builder) {
        builder.assign_('@error', 'ParseError.new(@input, @offset, ' + builder._quote(expected) + ')');
      });
    },

    assign_: function(name, value) {
      this._line(name + ' = ' + value);
    },

    jump_: function(address, name) {
      this.assign_(address, '_read_' + name);
    },

    if_: function(condition, block, else_, context) {
      if (typeof else_ !== 'function') {
        context = else_;
        else_   = null;
      }
      this._line('if ' + condition);
      this._indent(block, context);
      if (else_) {
        this._line('else');
        this._indent(else_, context);
      }
      this._line('end');
    },

    unless_: function(condition, block, else_, context) {
      if (typeof else_ !== 'function') {
        context = else_;
        else_   = null;
      }
      this._line('unless ' + condition);
      this._indent(block, context);
      if (else_) {
        this._line('else');
        this._indent(else_, context);
      }
      this._line('end');
    },

    whileNotNull_: function(expression, block, context) {
      this._line('until ' + expression + ' == ' + this.null_());
      this._indent(block, context);
      this._line('end');
    },

    stringMatch_: function(expression, string) {
      return expression + ' == ' + this._quote(string);
    },

    stringMatchCI_: function(expression, string) {
      return expression + '.downcase == ' + this._quote(string) + '.downcase';
    },

    regexMatch_: function(regex, string) {
      return string + ' =~ /' + regex.source + '/';
    },

    return_: function(expression) {
      this._line('return ' + expression);
    },

    arrayLookup_: function(expression, index) {
      return expression + '[' + index + ']';
    },

    append_: function(list, value) {
      this._line(list + ' << ' + value);
    },

    concatText_: function(string, value) {
      this._line(string + ' << ' + value + '.text');
    },

    decrement_: function(variable) {
      this._line(variable + ' -= 1');
    },

    stringLength_: function(string) {
      return string + '.size';
    },

    and_: function(left, right) {
      return left + ' and ' + right;
    },

    isNull_: function(expression) {
      return expression + '.nil?';
    },

    isZero_: function(expression) {
      return expression + ' <= 0';
    },

    offset_: function() {
      return '@offset';
    },

    emptyList_: function() {
      return '[]';
    },

    emptyString_: function() {
      return '""';
    },

    true_: function() {
      return 'true';
    },

    null_: function() {
      return 'nil';
    }
  });

  Canopy.Builders.Ruby = Builder;
})();
