# Canonical JSON of a state (sorted keys, no spaces), the same as canonical() in parity.test.ts, so both
# engines can compare states by their md5.
extends RefCounted


static func canon(v) -> String:
	match typeof(v):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_INT:
			return str(v)
		TYPE_FLOAT:
			return str(int(v)) if v == floor(v) and absf(v) < 1e15 else str(v)
		TYPE_STRING, TYPE_STRING_NAME:
			return quote(str(v))
		TYPE_ARRAY:
			var parts := []
			for x in v:
				parts.append(canon(x))
			return "[" + ",".join(parts) + "]"
		TYPE_DICTIONARY:
			# keys set with dot syntax are StringNames: sort them all as Strings
			var pairs := []
			for k in v:
				pairs.append([str(k), k])
			pairs.sort_custom(func(a, b): return a[0] < b[0])
			var parts := []
			for kv in pairs:
				parts.append(quote(kv[0]) + ":" + canon(v[kv[1]]))
			return "{" + ",".join(parts) + "}"
	return quote(str(v))


static func quote(s: String) -> String:
	var out := "\""
	for i in s.length():
		var c := s.unicode_at(i)
		if c == 0x22:
			out += "\\\""
		elif c == 0x5c:
			out += "\\\\"
		elif c < 0x20:
			out += "\\u%04x" % c
		else:
			out += String.chr(c)
	return out + "\""
